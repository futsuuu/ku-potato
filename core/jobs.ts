import { Effect } from "effect";
import { type Job, type JobDefinition, type JobQueueService, LmsArchiveGatewayError } from "./out_port.ts";

/** Wait for this job's terminal state, preserving its kind-specific input type. */
export const waitForJob = Effect.fn("Core.waitForJob")(function* <D extends JobDefinition, K extends D["kind"]>(
    queue: JobQueueService<D>,
    id: number,
    kind: K,
): Effect.fn.Return<Job<Extract<D, { kind: K }>>, LmsArchiveGatewayError> {
    for (;;) {
        const job = yield* queue.get(id, kind);
        if (job === undefined) {
            return yield* new LmsArchiveGatewayError({
                operation: "wait for job",
                message: "取得ジョブが見つかりません。",
            });
        }
        if (job.status === "succeeded" || job.status === "failed" || job.status === "blocked") return job;
        yield* Effect.sleep(50);
    }
});
