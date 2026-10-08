import { Effect, Layer } from "effect";
import { ApplicationError, type JobClientService, QueuedJobs } from "./in_port.ts";
import { type JobDefinition, JobQueue, type JobQueueService, type LmsArchiveGatewayError } from "./out_port.ts";
import { waitForJob } from "./jobs.ts";

const toApplicationError = (error: LmsArchiveGatewayError) =>
    new ApplicationError({ reason: "archive", message: error.message });

/** A submission client can live separately from a worker and its operation dependencies. */
export const makeJobClient = <D extends JobDefinition>(queue: JobQueueService<D>): JobClientService<D> => ({
    enqueue: (request) => queue.enqueue(request).pipe(Effect.mapError(toApplicationError)),
    get: (id, kind) => queue.get(id, kind).pipe(Effect.mapError(toApplicationError)),
    result: (id, kind) => queue.result(id, kind).pipe(Effect.mapError(toApplicationError)),
    wait: (id, kind) => waitForJob(queue, id, kind).pipe(Effect.mapError(toApplicationError)),
});

/** Bind the queue while constructing the layer; client effects expose no outbound requirements. */
export const QueuedJobsLive = Layer.effect(
    QueuedJobs,
    Effect.gen(function* () {
        const queue = yield* JobQueue;
        return QueuedJobs.of(makeJobClient(queue));
    }),
);
