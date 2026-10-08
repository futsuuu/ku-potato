import { openArchiveDatabase } from "../sqlite/mod.ts";
import {
    probeJobAdapter,
    type ProbeJobDefinition,
    setupProbeJobs,
    setupVoidJobs,
    voidJobAdapter,
} from "../sqlite/tests/job_fixture.ts";
import type { CourseMaterialsJobDefinition } from "./out_port.ts";
import { courseMaterialsJobHandlers } from "./course_material_job.ts";
import { courseMaterialsJobAdapter } from "../sqlite/course_material_job.ts";
import { assert, assertEquals } from "@std/assert";
import { Deferred, Effect, Layer, Option, Result } from "effect";
import { JobWorker } from "./in_port.ts";
import {
    JobQueue,
    LmsAuthenticationRequiredError,
    LmsCourseNotFoundError,
    LmsSourceGateway,
    LmsSourceGatewayError,
    type LmsSourceSession,
} from "./out_port.ts";
import { type JobHandlers, makeJobWorker, makeJobWorkerLayer, makeJobWorkersLayer } from "./worker.ts";
import { makeJobClient } from "./job_client.ts";
import { LmsCourseId } from "../domain/mod.ts";
import { makeJobQueue } from "../sqlite/queue.ts";
import { waitForJob } from "./jobs.ts";

const courseId = LmsCourseId("worker-course");
const snapshot = {
    courses: [{ lmsCourseId: courseId, name: "Course", availability: "available" as const }],
    courseMaterials: { lmsCourseId: courseId, folders: [] },
};

for (const failure of ["network", "authentication", "missing", "slow"] as const) {
    Deno.test(`durable worker handles ${failure} without losing its result association`, async () => {
        const root = await Deno.makeTempDir({ prefix: "ku-potato-worker-" });
        try {
            await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
                const queue = yield* makeJobQueue([courseMaterialsJobAdapter], `${root}/archive.sqlite3`);
                let attempts = 0;
                const session: LmsSourceSession = {
                    fetchCourses: Effect.die("unexpected fetchCourses"),
                    fetchMaterialResources: () => Effect.die("unexpected resource fetch"),
                    downloadResource: () => Effect.die("unexpected download"),
                    fetchCourseMaterials: () =>
                        Effect.gen(function* () {
                            if (failure === "network" && attempts < 3) {
                                return yield* new LmsSourceGatewayError({ operation: "fetch", message: "temporary" });
                            }
                            if (failure === "missing") {
                                return yield* new LmsCourseNotFoundError({ lmsCourseId: courseId, message: "missing" });
                            }
                            if (failure === "slow") yield* Effect.sleep(160);
                            return snapshot;
                        }),
                };
                const worker = yield* JobWorker.pipe(Effect.provide(
                    makeJobWorkerLayer(courseMaterialsJobHandlers, {
                        leaseMs: 80,
                        heartbeatMs: 10,
                        pollMs: 1,
                        retryDelayMs: 1,
                    })
                        .pipe(Layer.provide(Layer.mergeAll(
                            Layer.succeed(JobQueue, queue),
                            Layer.succeed(LmsSourceGateway, {
                                withSession: (_head, use) =>
                                    Effect.gen(function* () {
                                        attempts++;
                                        if (failure === "authentication") {
                                            return yield* new LmsAuthenticationRequiredError({
                                                message: "login needed",
                                            });
                                        }
                                        return yield* use(session);
                                    }),
                            }),
                        ))),
                ));
                yield* worker.run.pipe(Effect.forkScoped);
                const submitted = yield* queue.enqueue({
                    kind: "fetch-course-materials",
                    input: { lmsCourseId: courseId, head: "false" },
                });
                const terminal = yield* Effect.gen(function* () {
                    for (;;) {
                        const job = yield* queue.get(submitted.id, submitted.kind);
                        assert(job);
                        if (["succeeded", "failed", "blocked"].includes(job.status)) return job;
                        yield* Effect.sleep(5);
                    }
                }).pipe(Effect.timeout(5_000));
                assertEquals(attempts, failure === "network" ? 3 : 1);
                assertEquals(
                    terminal.status,
                    failure === "authentication" ? "blocked" : failure === "missing" ? "failed" : "succeeded",
                );
                if (terminal.status === "succeeded") {
                    assertEquals(yield* queue.result(terminal.id, terminal.kind), Option.some(snapshot));
                }
            })));
        } finally {
            await Deno.remove(root, { recursive: true });
        }
    });
}

Deno.test("independent job client and configured workers dispatch two kinds above KU-LMS capacity", async () => {
    const root = await Deno.makeTempDir({ prefix: "ku-potato-worker-kinds-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const database = yield* openArchiveDatabase(`${root}/archive.sqlite3`);
            yield* Effect.sync(() => setupProbeJobs(database));
            type Definitions = CourseMaterialsJobDefinition | ProbeJobDefinition;
            const queue = yield* makeJobQueue<Definitions>(
                [courseMaterialsJobAdapter, probeJobAdapter],
                `${root}/archive.sqlite3`,
            );
            const client = makeJobClient(
                yield* makeJobQueue<Definitions>(
                    [courseMaterialsJobAdapter, probeJobAdapter],
                    `${root}/archive.sqlite3`,
                ),
            );
            let active = 0;
            let peak = 0;
            const release = yield* Deferred.make<void>();
            const execute = <A>(value: A) =>
                Effect.gen(function* () {
                    active++;
                    peak = Math.max(peak, active);
                    yield* Deferred.await(release);
                    return value;
                }).pipe(Effect.ensuring(Effect.sync(() => {
                    active--;
                })));
            const handlers: JobHandlers<Definitions> = {
                "fetch-course-materials": {
                    execute: (input) =>
                        execute({
                            courses: [{
                                lmsCourseId: input.lmsCourseId,
                                name: input.lmsCourseId,
                                availability: "available" as const,
                            }],
                            courseMaterials: { lmsCourseId: input.lmsCourseId, folders: [] },
                        }),
                },
                "test-probe": { execute: (input) => execute({ text: `probe:${input.key}` }) },
            };
            const worker = makeJobWorker(queue, handlers, { pollMs: 1 });
            yield* Layer.build(makeJobWorkersLayer(6).pipe(Layer.provide(Layer.succeed(JobWorker, worker))));
            const courseJobs = yield* Effect.forEach(["a", "b", "c", "d"], (id) =>
                client.enqueue({
                    kind: "fetch-course-materials",
                    input: { lmsCourseId: LmsCourseId(id), head: "false" },
                }));
            const probes = yield* Effect.forEach(["e", "f", "g", "h"], (key) =>
                client.enqueue({
                    kind: "test-probe",
                    input: { key },
                }));
            yield* Effect.gen(function* () {
                while (active < 6) yield* Effect.sleep(5);
            }).pipe(Effect.timeout(5_000));
            assertEquals(peak, 6);
            yield* Deferred.succeed(release, undefined);
            yield* Effect.gen(function* () {
                for (;;) {
                    const states = yield* Effect.forEach(
                        [...courseJobs, ...probes],
                        (job) => client.get(job.id, job.kind),
                    );
                    if (states.every((job) => job?.status === "succeeded")) return;
                    yield* Effect.sleep(5);
                }
            }).pipe(Effect.timeout(5_000));
            assertEquals(peak, 6);
            for (const job of courseJobs) {
                const result = yield* client.result(job.id, job.kind);
                assert(Option.isSome(result));
                assertEquals(result.value.courseMaterials.lmsCourseId, job.input.lmsCourseId);
            }
            for (const job of probes) {
                const result = yield* client.result(job.id, job.kind);
                assertEquals(Option.getOrThrow(result).text, `probe:${job.input.key}`);
            }
            // These calls must be rejected at compile time, not widened to a union result.
            const checkInvalidRequests = () => [
                // @ts-expect-error A kind cannot accept another kind's input.
                client.enqueue({ kind: "test-probe", input: { lmsCourseId: courseId, head: "false" } }),
                // @ts-expect-error A completion cannot associate a probe output with a lecture job.
                queue.complete({ job: courseJobs[0], output: { text: "wrong" } }),
            ];
            void checkInvalidRequests;
        })));
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("missing execution handler fails visibly while a registered kind keeps progressing", async () => {
    const root = await Deno.makeTempDir({ prefix: "ku-potato-worker-handler-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const database = yield* openArchiveDatabase(`${root}/archive.sqlite3`);
            yield* Effect.sync(() => setupProbeJobs(database));
            type Definitions = CourseMaterialsJobDefinition | ProbeJobDefinition;
            const queue = yield* makeJobQueue<Definitions>(
                [courseMaterialsJobAdapter, probeJobAdapter],
                `${root}/archive.sqlite3`,
            );
            const unsupported = yield* queue.enqueue({
                kind: "fetch-course-materials",
                input: { lmsCourseId: courseId, head: "false" },
            });
            const probe = yield* queue.enqueue({ kind: "test-probe", input: { key: "ok" } });
            // Simulate an incomplete runtime registration, which the typed registry ordinarily rejects.
            const handlers = {
                "test-probe": { execute: () => Effect.succeed({ text: "ok" }) },
            } as unknown as JobHandlers<
                Definitions
            >;
            yield* makeJobWorker(queue, handlers, { pollMs: 1 }).run.pipe(Effect.forkScoped);
            yield* Effect.gen(function* () {
                for (;;) {
                    if ((yield* queue.get(probe.id, probe.kind))?.status === "succeeded") return;
                    yield* Effect.sleep(5);
                }
            }).pipe(Effect.timeout(5_000));
            const failed = yield* queue.get(unsupported.id, unsupported.kind);
            assertEquals(failed?.status, "failed");
            assertEquals(failed?.errorTag, "JobHandlerMissing");
            assertEquals(failed?.attempts, 1);
            assertEquals(yield* queue.result(probe.id, probe.kind), Option.some({ text: "ok" }));
        })));
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("common worker preserves a stored void result independently of result presence", async () => {
    const root = await Deno.makeTempDir({ prefix: "ku-potato-void-worker-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const path = `${root}/archive.sqlite3`;
            const database = yield* openArchiveDatabase(path);
            setupVoidJobs(database);
            const queue = yield* makeJobQueue([voidJobAdapter], path);
            const submitted = yield* queue.enqueue({ kind: "test-void", input: { key: "void" } });
            assertEquals(yield* queue.result(submitted.id, submitted.kind), Option.none());
            assertEquals(yield* queue.result(999_999, submitted.kind), Option.none());
            let executions = 0;
            const worker = makeJobWorker(queue, {
                "test-void": {
                    execute: () =>
                        Effect.sync(() => {
                            executions++;
                        }),
                },
            }, { pollMs: 1 });
            yield* worker.run.pipe(Effect.forkScoped);
            const terminal = yield* waitForJob(queue, submitted.id, submitted.kind).pipe(Effect.timeout(5_000));
            assertEquals(terminal.status, "succeeded");
            assertEquals(executions, 1);
            const result = yield* queue.result(submitted.id, submitted.kind);
            assert(Option.isSome(result));
            assertEquals(result.value, undefined);
            assertEquals(database.$client.prepare("select done from void_jobs where job_id=?").get(submitted.id), {
                done: 1,
            });
        })));
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("worker host starts the configured count and interrupts every worker on shutdown", async () => {
    let active = 0;
    let stopped = 0;
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const ready = yield* Deferred.make<void>();
        const run = Effect.gen(function* () {
            active++;
            if (active === 5) yield* Deferred.succeed(ready, undefined);
            return yield* Effect.never;
        }).pipe(Effect.ensuring(Effect.sync(() => {
            active--;
            stopped++;
        })));
        yield* Layer.build(makeJobWorkersLayer(5).pipe(Layer.provide(Layer.succeed(JobWorker, { run }))));
        yield* Deferred.await(ready).pipe(Effect.timeout(5_000));
        assertEquals(active, 5);
    })));
    assertEquals(active, 0);
    assertEquals(stopped, 5);
});

Deno.test("worker host rejects invalid counts before starting a worker", async () => {
    let starts = 0;
    const worker = JobWorker.of({
        run: Effect.sync(() => starts++).pipe(Effect.andThen(Effect.never)),
    });
    for (const count of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const result = await Effect.runPromise(Effect.scoped(Effect.result(
            Layer.build(makeJobWorkersLayer(count).pipe(Layer.provide(Layer.succeed(JobWorker, worker)))),
        )));
        assert(Result.isFailure(result));
        assertEquals(result.failure._tag, "JobWorkerConfigurationError");
    }
    assertEquals(starts, 0);
});
