/* oxlint-disable effecttsgo/schema-sync -- Storage validation must complete synchronously inside the fenced SQLite transaction. */
import { Option, Schema } from "effect";
import type { Job, JobDefinition } from "../core/out_port.ts";
import type { Database } from "./mod.ts";

/** Storage callbacks run synchronously inside the queue's fenced transaction. */
export type JobTransaction = Pick<Database, "insert" | "select" | "selectDistinct" | "update" | "run" | "get">;
export type JobStorageOptions<D extends JobDefinition> = {
    readonly kind: D["kind"];
    readonly maxAttempts?: number;
    readonly inputSchema: Schema.Codec<D["input"], unknown>;
    readonly outputSchema: Schema.Codec<D["output"], unknown>;
    readonly dedupKey: (input: D["input"]) => string;
    readonly insertInput: (database: JobTransaction, jobId: number, input: D["input"]) => void;
    readonly readInput: (database: JobTransaction, jobId: number) => unknown;
    readonly saveResult: (database: JobTransaction, job: Job<D>, output: D["output"]) => void;
    readonly readResult: (database: JobTransaction, jobId: number) => Option.Option<unknown>;
};

/** Validated, type-erased callbacks let the scheduler remain independent of operation types. */
export type JobStorageAdapter<D extends JobDefinition = JobDefinition> = {
    readonly kind: D["kind"];
    readonly maxAttempts: number;
    readonly definition?: D;
    readonly validateInput: (input: unknown) => unknown;
    readonly dedupKey: (input: unknown) => string;
    readonly insertInput: (database: JobTransaction, jobId: number, input: unknown) => void;
    readonly readInput: (database: JobTransaction, jobId: number) => unknown;
    readonly saveResult: (database: JobTransaction, job: Job<JobDefinition>, output: unknown) => void;
    readonly readResult: (database: JobTransaction, jobId: number) => Option.Option<unknown>;
};

export const defineJobStorageAdapter = <D extends JobDefinition>(
    options: JobStorageOptions<D>,
): JobStorageAdapter<D> => {
    const input = Schema.decodeUnknownSync(options.inputSchema);
    const output = Schema.decodeUnknownSync(options.outputSchema);
    return {
        kind: options.kind,
        maxAttempts: Schema.decodeSync(Schema.Int.check(Schema.isGreaterThan(0)))(options.maxAttempts ?? 3),
        validateInput: input,
        dedupKey: (value) => options.dedupKey(input(value)),
        insertInput: (database, jobId, value) => options.insertInput(database, jobId, input(value)),
        readInput: (database, jobId) => input(options.readInput(database, jobId)),
        saveResult: (database, job, value) => {
            if (job.kind !== options.kind) throw new Error(`Expected ${options.kind}, received ${job.kind}.`);
            // The kind and input are checked here before recovering the adapter's concrete job type.
            options.saveResult(database, { ...job, input: input(job.input) } as Job<D>, output(value));
        },
        readResult: (database, jobId) => {
            return Option.map(options.readResult(database, jobId), output);
        },
    };
};
