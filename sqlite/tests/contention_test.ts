import { assert, assertEquals, assertInstanceOf, assertStringIncludes } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { Effect, Option, Result } from "effect";
import { LmsArchiveGatewayError } from "../../core/out_port.ts";
import { LmsCourseId } from "../../domain/mod.ts";
import { makeLmsArchiveGateway } from "../mod.ts";
import { courseMaterialsJobAdapter } from "../course_material_job.ts";
import { makeJobQueue } from "../queue.ts";

/** A separate native connection holds the writer lock past the 100 ms busy timeout. */
const withWriterLock = <A, E, R>(databasePath: string, use: Effect.Effect<A, E, R>, releaseAfterMs?: number) =>
    Effect.scoped(Effect.gen(function* () {
        const lock = yield* Effect.acquireRelease(
            Effect.sync(() => {
                const database = new DatabaseSync(databasePath);
                database.exec("begin immediate");
                let locked = true;
                const release = () => {
                    if (locked) {
                        database.exec("rollback");
                        locked = false;
                    }
                };
                return {
                    release,
                    close: () => {
                        release();
                        database.close();
                    },
                };
            }),
            (lock) => Effect.sync(lock.close),
        );
        if (releaseAfterMs !== undefined) {
            yield* Effect.sleep(releaseAfterMs).pipe(Effect.andThen(Effect.sync(lock.release)), Effect.forkScoped);
        }
        return yield* use;
    }));

const courseId = LmsCourseId("busy-course");
const courses = [{ lmsCourseId: courseId, name: "Busy course", availability: "available" }] as const;
const snapshot = { courses, courseMaterials: { lmsCourseId: courseId, folders: [] } };

Deno.test("queue and archive do not retry an invalid snapshot whose course ID contains busy", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-invalid-snapshot-" });
    const path = `${directory}/archive.sqlite3`;
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const archive = yield* makeLmsArchiveGateway(path);
            const queue = yield* makeJobQueue([courseMaterialsJobAdapter], path);
            const job = yield* queue.enqueue({
                kind: "fetch-course-materials",
                input: { lmsCourseId: courseId, head: "false" },
            });
            const owner = yield* queue.claim("owner", 5000);
            assert(owner);
            let evaluations = 0;
            const invalidSnapshot = {
                get courses() {
                    evaluations++;
                    return [];
                },
                courseMaterials: snapshot.courseMaterials,
            };
            const completion = yield* Effect.result(queue.complete({ job: owner, output: invalidSnapshot }));
            assert(Result.isFailure(completion));
            assertEquals(evaluations, 1);
            const write = yield* Effect.result(archive.appendCourseMaterials(invalidSnapshot));
            assert(Result.isFailure(write));
            assertEquals(evaluations, 2);
            assertEquals(yield* queue.result(1, "fetch-course-materials"), Option.none());
            assertEquals((yield* queue.get(job.id, "fetch-course-materials"))?.status, "running");
            assertEquals(yield* queue.complete({ job: owner, output: snapshot }), true);
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("queue retries enqueue, claim, heartbeat and completion across real writer contention", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-queue-contention-" });
    const path = `${directory}/archive.sqlite3`;
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const queue = yield* makeJobQueue([courseMaterialsJobAdapter], path);
            yield* queue.get(0, "fetch-course-materials"); // Open the lazy connection before holding another connection's lock.
            const job = yield* withWriterLock(
                path,
                queue.enqueue({ kind: "fetch-course-materials", input: { lmsCourseId: courseId, head: "false" } }),
                200,
            );
            const owner = yield* withWriterLock(path, queue.claim("owner", 5000), 200);
            assert(owner);
            assertEquals(owner.id, job.id);
            assertEquals(yield* withWriterLock(path, queue.heartbeat(owner, 5000), 200), true);
            assertEquals(yield* withWriterLock(path, queue.complete({ job: owner, output: snapshot }), 200), true);
            assertEquals((yield* queue.get(job.id, "fetch-course-materials"))?.status, "succeeded");
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("archive retries real writer contention while WAL reads remain available", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-archive-contention-" });
    const path = `${directory}/archive.sqlite3`;
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const archive = yield* makeLmsArchiveGateway(path);
            yield* withWriterLock(path, archive.appendCourses(courses), 200);
            assertEquals(yield* withWriterLock(path, archive.listCourses), courses);
            yield* withWriterLock(path, archive.appendCourseMaterials(snapshot), 200);
            assertEquals(yield* archive.listCourseMaterials(courseId), snapshot.courseMaterials);
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("queue and archive exhaust bounded contention retries and recover on the same gateways", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-contention-limit-" });
    const path = `${directory}/archive.sqlite3`;
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const archive = yield* makeLmsArchiveGateway(path);
            const queue = yield* makeJobQueue([courseMaterialsJobAdapter], path);
            yield* queue.get(0, "fetch-course-materials");
            const started = performance.now();
            const [queueResult, archiveResult] = yield* withWriterLock(
                path,
                Effect.gen(function* () {
                    return [
                        yield* Effect.result(
                            queue.enqueue({
                                kind: "fetch-course-materials",
                                input: { lmsCourseId: courseId, head: "false" },
                            }).pipe(Effect.asVoid),
                        ),
                        yield* Effect.result(archive.appendCourses(courses)),
                    ] as const;
                }),
            );
            assert(
                performance.now() - started < 5000,
                "Contended operations must stop after their finite retry budget.",
            );
            for (const result of [queueResult, archiveResult]) {
                assert(Result.isFailure(result));
                assertInstanceOf(result.failure, LmsArchiveGatewayError);
                assertStringIncludes(result.failure.message, "database is locked");
                assertStringIncludes(result.failure.message, "ERR_SQLITE_ERROR");
            }
            assertEquals(
                (yield* queue.enqueue({
                    kind: "fetch-course-materials",
                    input: { lmsCourseId: courseId, head: "false" },
                })).status,
                "queued",
            );
            yield* archive.appendCourses(courses);
            assertEquals(yield* archive.listCourses, courses);
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});
