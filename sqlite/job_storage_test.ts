import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { Effect, Option, Result } from "effect";
import type {
    CourseMaterialsJobDefinition,
    JobCompletion,
    JobQueueService,
    LmsArchiveGatewayError,
} from "../core/out_port.ts";
import { LmsCourseId } from "../domain/mod.ts";
import { courseMaterialsJobAdapter } from "./course_material_job.ts";
import { openArchiveDatabase } from "./mod.ts";
import { makeJobQueue } from "./queue.ts";
import { defineJobStorageAdapter } from "./job_storage.ts";
import { sql } from "drizzle-orm";
import {
    probeJobAdapter,
    type ProbeJobDefinition,
    probeJobStorageOptions,
    setupProbeJobs,
    setupVoidJobs,
    type VoidJobDefinition,
    voidJobStorageOptions,
} from "./tests/job_fixture.ts";

type Definitions = CourseMaterialsJobDefinition | ProbeJobDefinition;
const courseId = LmsCourseId("course-1");
const courseRequest = { kind: "fetch-course-materials", input: { lmsCourseId: courseId, head: "false" } } as const;
const courseOutput = {
    courses: [{ lmsCourseId: courseId, name: "Course", availability: "available" }],
    courseMaterials: { lmsCourseId: courseId, folders: [] },
} as const;

// These calls create effects without running them, and assert the public compile-time contract.
const checkTypes = (queue: JobQueueService<Definitions>): void => {
    const course = queue.enqueue(courseRequest);
    const probe = queue.enqueue({ kind: "test-probe", input: { key: "key" } });
    const courseType: Effect.Effect<
        { kind: "fetch-course-materials"; input: CourseMaterialsJobDefinition["input"] },
        LmsArchiveGatewayError
    > = course;
    const probeType: Effect.Effect<{ kind: "test-probe"; input: ProbeJobDefinition["input"] }, LmsArchiveGatewayError> =
        probe;
    const resultType: Effect.Effect<Option.Option<ProbeJobDefinition["output"]>, LmsArchiveGatewayError> = queue.result(
        1,
        "test-probe",
    );
    // @ts-expect-error A kind cannot receive another kind's input.
    void queue.enqueue({ kind: "test-probe", input: courseRequest.input });
    // @ts-expect-error Unregistered kinds cannot be submitted.
    void queue.enqueue({ kind: "missing", input: {} });
    void courseType;
    void probeType;
    void resultType;
};

Deno.test("generic queue registers a second kind with isolated deduplication, typed results and atomic rollback", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-generic-queue-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const path = `${directory}/archive.sqlite3`;
            const database = yield* openArchiveDatabase(path);
            setupProbeJobs(database);
            const queue = yield* makeJobQueue<Definitions>([courseMaterialsJobAdapter, probeJobAdapter], path);
            checkTypes(queue);
            const course = yield* queue.enqueue(courseRequest);
            const probe = yield* queue.enqueue({ kind: "test-probe", input: { key: "false:course-1" } });
            assert(course.id !== probe.id);
            assertThrows(() =>
                database.$client.prepare(
                    "insert into course_material_jobs(job_id,lms_course_id,head) values(?,?,'false')",
                ).run(probe.id, courseId)
            );
            assertThrows(() =>
                database.$client.prepare(
                    "update course_material_jobs set result_ref=999999 where job_id=?",
                ).run(course.id)
            );
            assertEquals((yield* queue.enqueue({ kind: "test-probe", input: { key: "false:course-1" } })).id, probe.id);
            assertEquals(yield* queue.result(probe.id, "test-probe"), Option.none());
            for (
                const read of [
                    queue.get(course.id, "test-probe").pipe(Effect.asVoid),
                    queue.result(course.id, "test-probe").pipe(Effect.asVoid),
                ]
            ) {
                const result = yield* Effect.result(read);
                assert(Result.isFailure(result));
                assertStringIncludes(result.failure.message, "requested test-probe");
            }
            const first = yield* queue.claim("worker", 1000);
            assert(first?.kind === "fetch-course-materials");
            yield* queue.complete({
                job: { ...first, input: { ...first.input, lmsCourseId: LmsCourseId("forged-course") } },
                output: courseOutput,
            });
            const second = yield* queue.claim("worker", 1000);
            assert(second?.kind === "test-probe");
            assertEquals(second.maxAttempts, 1);
            const invalid = { job: second, output: courseOutput } as unknown as JobCompletion<Definitions>;
            assert(Result.isFailure(yield* Effect.result(queue.complete(invalid))));
            assertEquals((yield* queue.get(second.id, "test-probe"))?.status, "running");
            database.$client.exec(`create trigger reject_probe before update on jobs
                when new.kind='test-probe' and new.status='succeeded'
                begin select raise(abort, 'reject'); end`);
            assert(
                Result.isFailure(
                    yield* Effect.result(queue.complete({ job: second, output: { text: "rolled back" } })),
                ),
            );
            assertEquals(database.$client.prepare("select result from probe_jobs where job_id=?").get(second.id), {
                result: null,
            });
            database.$client.exec("drop trigger reject_probe");
            assertEquals(yield* queue.complete({ job: second, output: { text: "probe result" } }), true);
            assertEquals(yield* queue.result(second.id, "test-probe"), Option.some({ text: "probe result" }));
            database.$client.prepare("update probe_jobs set result=null where job_id=?").run(second.id);
            const missingResult = yield* Effect.result(queue.result(second.id, "test-probe"));
            assert(Result.isFailure(missingResult));
            assertStringIncludes(missingResult.failure.message, "has no stored result");
            assertEquals(yield* queue.result(first.id, "fetch-course-materials"), Option.some(courseOutput));
            assert(
                Result.isFailure(
                    yield* Effect.result(
                        queue.enqueue({
                            kind: "test-probe",
                            input: { key: 123 } as unknown as ProbeJobDefinition["input"],
                        }),
                    ),
                ),
            );
            const duplicate = yield* makeJobQueue([probeJobAdapter, probeJobAdapter], path);
            const registered = yield* Effect.result(duplicate.get(0, "test-probe"));
            assert(Result.isFailure(registered));
            assertStringIncludes(registered.failure.message, "Duplicate job kind");
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("unknown kinds and missing subtype inputs fail diagnostically without blocking valid jobs", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-invalid-kind-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const path = `${directory}/archive.sqlite3`;
            const database = yield* openArchiveDatabase(path);
            setupProbeJobs(database);
            database.$client.exec(`insert into jobs(kind,dedup_key,status,available_at) values
                ('missing','unknown','queued',0),('test-probe','no-child','queued',0)`);
            const queue = yield* makeJobQueue<Definitions>([courseMaterialsJobAdapter, probeJobAdapter], path);
            const good = yield* queue.enqueue({ kind: "test-probe", input: { key: "valid" } });
            const owner = yield* queue.claim("worker", 1000);
            assert(owner);
            assertEquals(owner.id, good.id);
            const invalid = database.$client.prepare(
                "select status,error_tag,last_error from jobs where id< ? order by id",
            ).all(good.id);
            assertEquals(invalid.map((row) => [row.status, row.error_tag]), [["failed", "InvalidJob"], [
                "failed",
                "InvalidJob",
            ]]);
            assertStringIncludes(String(invalid[0].last_error), "Unregistered job kind: missing");
            assert(String(invalid[1].last_error).length > 0);
            yield* queue.fail({ ...owner, attempts: 0, maxAttempts: 999 }, {
                message: "stop",
                tag: "ProbeFailure",
                retry: true,
                blocked: false,
            }, 0);
            assertEquals((yield* queue.get(good.id, "test-probe"))?.status, "failed");
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

for (const invalidSave of ["missing", "wrong-job"] as const) {
    Deno.test(`completion rolls back all writes when the saved result is ${invalidSave}`, async () => {
        const directory = await Deno.makeTempDir({ prefix: "ku-result-presence-" });
        try {
            await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
                const path = `${directory}/archive.sqlite3`;
                const database = yield* openArchiveDatabase(path);
                setupVoidJobs(database);
                const adapter = defineJobStorageAdapter<VoidJobDefinition>({
                    ...voidJobStorageOptions,
                    saveResult: (transaction, job, output) => {
                        transaction.run(sql`update void_jobs set key='changed' where job_id=${job.id}`);
                        if (invalidSave === "missing") return;
                        const target = invalidSave === "wrong-job" ? { ...job, id: job.id + 1 } : job;
                        voidJobStorageOptions.saveResult(transaction, target, output);
                    },
                });
                const queue = yield* makeJobQueue([adapter], path);
                const first = yield* queue.enqueue({ kind: "test-void", input: { key: "first" } });
                const second = yield* queue.enqueue({ kind: "test-void", input: { key: "second" } });
                const owner = yield* queue.claim("worker", 1_000);
                assert(owner);
                const completion = yield* Effect.result(queue.complete({ job: owner, output: undefined }));
                assert(Result.isFailure(completion));
                assertEquals(completion.failure.operation, "complete job");
                assertStringIncludes(completion.failure.message, "has no stored result after saving");
                assertEquals((yield* queue.get(first.id, first.kind))?.status, "running");
                assertEquals((yield* queue.get(second.id, second.kind))?.status, "queued");
                assertEquals(database.$client.prepare("select key,done from void_jobs order by job_id").all(), [
                    { key: "first", done: null },
                    { key: "second", done: null },
                ]);
                assertEquals(yield* queue.result(first.id, first.kind), Option.none());
            })));
        } finally {
            await Deno.remove(directory, { recursive: true });
        }
    });
}

Deno.test("completion rolls back saved output that does not match its result schema", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-result-schema-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const path = `${directory}/archive.sqlite3`;
            const database = yield* openArchiveDatabase(path);
            setupProbeJobs(database);
            const adapter = defineJobStorageAdapter<ProbeJobDefinition>({
                ...probeJobStorageOptions,
                readResult: (transaction, id) =>
                    Option.map(probeJobStorageOptions.readResult(transaction, id), () => ({ text: 123 })),
            });
            const queue = yield* makeJobQueue([adapter], path);
            const submitted = yield* queue.enqueue({ kind: "test-probe", input: { key: "schema" } });
            const owner = yield* queue.claim("worker", 1_000);
            assert(owner);
            const completion = yield* Effect.result(queue.complete({ job: owner, output: { text: "valid input" } }));
            assert(Result.isFailure(completion));
            assertEquals(completion.failure.operation, "complete job");
            assertEquals((yield* queue.get(submitted.id, submitted.kind))?.status, "running");
            assertEquals(database.$client.prepare("select result from probe_jobs where job_id=?").get(submitted.id), {
                result: null,
            });
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});
