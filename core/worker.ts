import { JobWorker, JobWorkerConfigurationError } from "./in_port.ts";
import {
    type ApplicationJobDefinition,
    type Job,
    type JobCompletion,
    type JobDefinition,
    type JobFailure,
    JobQueue,
    type JobQueueService,
} from "./out_port.ts";
import { Effect, Layer, Result, Schema } from "effect";

export interface WorkerOptions {
    readonly leaseMs?: number;
    readonly heartbeatMs?: number;
    readonly pollMs?: number;
    readonly retryDelayMs?: number;
}

export type JobHandlers<D extends JobDefinition> = {
    readonly [K in D["kind"]]: {
        readonly execute: (
            input: Extract<D, { kind: K }>["input"],
        ) => Effect.Effect<Extract<D, { kind: K }>["output"], JobFailure>;
        readonly retryDelayMs?: (attempt: number) => number;
    };
};

/** Bind operation dependencies before starting the common worker. */
export const makeJobWorker = <D extends JobDefinition>(
    queue: JobQueueService<D>,
    handlers: JobHandlers<D>,
    options: WorkerOptions = {},
) => {
    // oxlint-disable-next-line effecttsgo/crypto-random-uuid -- Worker ownership is local host identity.
    const ownerId = crypto.randomUUID();
    const leaseMs = options.leaseMs ?? 60_000;
    const heartbeatMs = options.heartbeatMs ?? 10_000;
    const pollMs = options.pollMs ?? 100;
    const retryDelayMs = options.retryDelayMs ?? 1_000;

    const execute = (job: Job<D>): Effect.Effect<JobCompletion<D>, JobFailure> => {
        // The mapped registry guarantees the kind/input/output correlation at registration.
        // TypeScript cannot retain that correlation when indexing with a runtime union.
        const handler = handlers[job.kind as D["kind"]] as {
            readonly execute: (input: D["input"]) => Effect.Effect<D["output"], JobFailure>;
        } | undefined;
        if (handler === undefined) {
            return Effect.fail({
                message: `No execution handler is registered for ${job.kind}.`,
                tag: "JobHandlerMissing",
                retry: false,
                blocked: false,
            });
        }
        return handler.execute(job.input).pipe(Effect.map((output) => ({ job, output }) as JobCompletion<D>));
    };

    const step = Effect.gen(function* () {
        const job = yield* queue.claim(ownerId, leaseMs);
        if (job === undefined) {
            yield* Effect.sleep(pollMs);
            return;
        }
        const heartbeat = Effect.gen(function* () {
            while (true) {
                yield* Effect.sleep(heartbeatMs);
                if (
                    !(yield* queue.heartbeat(job, leaseMs).pipe(Effect.mapError((error): JobFailure => ({
                        message: error.message,
                        tag: error._tag,
                        retry: false,
                        blocked: false,
                    }))))
                ) {
                    return yield* Effect.fail({
                        message: "ジョブの所有権が失効しました。",
                        tag: "JobLeaseExpired",
                        retry: false,
                        blocked: false,
                    });
                }
            }
        });
        const completed = yield* Effect.result(Effect.raceFirst(execute(job), heartbeat));
        if (Result.isSuccess(completed)) {
            yield* queue.complete(completed.success);
        } else {
            const delay = handlers[job.kind as D["kind"]]?.retryDelayMs?.(job.attempts) ?? retryDelayMs * job.attempts;
            yield* queue.fail(job, completed.failure, delay);
        }
    });

    const run = Effect.gen(function* () {
        while (true) {
            yield* step.pipe(
                Effect.catchCause((cause) => Effect.logError(cause).pipe(Effect.andThen(Effect.sleep(pollMs)))),
            );
        }
    });
    return { run };
};

/** Handler effects are resolved while constructing the layer; run exposes no outbound requirements. */
export const makeJobWorkerLayer = <E, R>(
    handlers: Effect.Effect<JobHandlers<ApplicationJobDefinition>, E, R>,
    options: WorkerOptions = {},
) => Layer.effect(
    JobWorker,
    Effect.gen(function* () {
        const queue = yield* JobQueue;
        const registered = yield* handlers;
        return JobWorker.of(makeJobWorker(queue, registered, options));
    }),
);

/** The host chooses its worker count independently of operation-specific resource limits. */
export const makeJobWorkersLayer = (workerCount: number) =>
    Layer.effectDiscard(Effect.gen(function* () {
        const count = yield* Schema.decodeEffect(
            Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
        )(workerCount).pipe(Effect.mapError(() =>
            new JobWorkerConfigurationError({
                message: "workerCount must be a positive safe integer.",
            })
        ));
        const worker = yield* JobWorker;
        for (let index = 0; index < count; index++) {
            yield* worker.run.pipe(Effect.forkScoped);
        }
    }));
