import { assert, assertEquals } from "@std/assert";
import { Context, Effect, Layer, Option, Result } from "effect";
import { LmsCourseId } from "../domain/mod.ts";
import { courseMaterialsJobAdapter } from "../sqlite/course_material_job.ts";
import { openArchiveDatabase } from "../sqlite/mod.ts";
import { makeJobQueue, makeJobQueueLayer } from "../sqlite/queue.ts";
import {
    probeJobAdapter,
    type ProbeJobDefinition,
    setupProbeJobs,
    setupVoidJobs,
    voidJobAdapter,
    type VoidJobDefinition,
} from "../sqlite/tests/job_fixture.ts";
import { type ApplicationError, QueuedJobs } from "./in_port.ts";
import { makeJobClient, QueuedJobsLive } from "./job_client.ts";
import { makeJobWorker } from "./worker.ts";

Deno.test("queued client layer binds only storage and leaves work queued without a worker", async () => {
    const root = await Deno.makeTempDir({ prefix: "ku-potato-job-client-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const context = yield* Layer.build(
                QueuedJobsLive.pipe(Layer.provide(makeJobQueueLayer(
                    [courseMaterialsJobAdapter],
                    `${root}/archive.sqlite3`,
                ))),
            );
            const client = Context.get(context, QueuedJobs);
            const submitted = yield* client.enqueue({
                kind: "fetch-course-materials",
                input: { lmsCourseId: LmsCourseId("client-course"), head: "false" },
            });
            yield* Effect.sleep(20);
            assertEquals((yield* client.get(submitted.id, submitted.kind))?.status, "queued");
            assertEquals(yield* client.result(submitted.id, submitted.kind), Option.none());
            assertEquals(yield* client.get(999_999, submitted.kind), undefined);
            const missing = yield* Effect.result(client.wait(999_999, submitted.kind));
            assert(Result.isFailure(missing));
            assertEquals(missing.failure._tag, "ApplicationError");
            assertEquals(missing.failure.reason, "archive");
        })));
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("job client exposes failed and blocked terminal jobs, preserves void output, and translates storage errors", async () => {
    const root = await Deno.makeTempDir({ prefix: "ku-potato-job-client-terminal-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const path = `${root}/archive.sqlite3`;
            const database = yield* openArchiveDatabase(path);
            setupProbeJobs(database);
            setupVoidJobs(database);
            type Definitions = ProbeJobDefinition | VoidJobDefinition;
            const queue = yield* makeJobQueue<Definitions>([probeJobAdapter, voidJobAdapter], path);
            const client = makeJobClient(yield* makeJobQueue<Definitions>([probeJobAdapter, voidJobAdapter], path));
            yield* makeJobWorker(queue, {
                "test-probe": {
                    execute: ({ key }) =>
                        Effect.fail({
                            message: key,
                            tag: "TestFailure",
                            retry: false,
                            blocked: key === "blocked",
                        }),
                },
                "test-void": { execute: () => Effect.void },
            }, { pollMs: 1 }).run.pipe(Effect.forkScoped);
            for (const key of ["failed", "blocked"]) {
                const submitted = yield* client.enqueue({ kind: "test-probe", input: { key } });
                const terminal = yield* client.wait(submitted.id, submitted.kind).pipe(Effect.timeout(5_000));
                assertEquals(terminal.status, key);
                assertEquals(terminal.errorTag, "TestFailure");
                assertEquals(terminal.lastError, key);
                assertEquals(yield* client.result(submitted.id, submitted.kind), Option.none());
                const wrongKind = yield* Effect.result(client.get(submitted.id, "test-void"));
                assert(Result.isFailure(wrongKind));
                assertEquals(wrongKind.failure.reason, "archive");
            }
            const submitted = yield* client.enqueue({ kind: "test-void", input: { key: "void" } });
            assertEquals(
                (yield* client.wait(submitted.id, submitted.kind).pipe(Effect.timeout(5_000))).status,
                "succeeded",
            );
            const result = yield* client.result(submitted.id, submitted.kind);
            assert(Option.isSome(result));
            assertEquals(result.value, undefined);
            const checkTypeCorrelation = () => {
                // @ts-expect-error A kind-specific result must retain its output type.
                const wrong: Effect.Effect<Option.Option<{ text: string }>, ApplicationError> = client.result(
                    1,
                    "test-void",
                );
                return wrong;
            };
            void checkTypeCorrelation;
        })));
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
