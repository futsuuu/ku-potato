import { eq } from "drizzle-orm";
import { integer, snakeCase, text } from "drizzle-orm/sqlite-core";
import { Option, Schema } from "effect";
import type { JobDefinition } from "../../core/out_port.ts";
import type { Database } from "../mod.ts";
import { defineJobStorageAdapter, type JobStorageOptions } from "../job_storage.ts";

export interface ProbeJobDefinition extends JobDefinition {
    readonly kind: "test-probe";
    readonly input: { readonly key: string };
    readonly output: { readonly text: string };
}
const probeJobs = snakeCase.table("probe_jobs", {
    jobId: integer().primaryKey(),
    key: text().notNull(),
    result: text(),
});
export const setupProbeJobs = (database: Database): void => {
    database.$client.exec(`create table if not exists probe_jobs (
        job_id integer primary key references jobs(id), key text not null, result text
    )`);
};
export const probeJobStorageOptions: JobStorageOptions<ProbeJobDefinition> = {
    kind: "test-probe",
    maxAttempts: 1,
    inputSchema: Schema.Struct({ key: Schema.String }),
    outputSchema: Schema.Struct({ text: Schema.String }),
    dedupKey: ({ key }) => key,
    insertInput: (database, jobId, input) => {
        database.insert(probeJobs).values({ jobId, key: input.key }).run();
    },
    readInput: (database, jobId) => {
        const row = database.select().from(probeJobs).where(eq(probeJobs.jobId, jobId)).get();
        return row === undefined ? undefined : { key: row.key };
    },
    saveResult: (database, job, output) => {
        database.update(probeJobs).set({ result: output.text }).where(eq(probeJobs.jobId, job.id)).run();
    },
    readResult: (database, jobId) => {
        const row = database.select().from(probeJobs).where(eq(probeJobs.jobId, jobId)).get();
        return row?.result == null ? Option.none() : Option.some({ text: row.result });
    },
};
export const probeJobAdapter = defineJobStorageAdapter(probeJobStorageOptions);

export interface VoidJobDefinition extends JobDefinition {
    readonly kind: "test-void";
    readonly input: { readonly key: string };
    readonly output: void;
}

const voidJobs = snakeCase.table("void_jobs", {
    jobId: integer().primaryKey(),
    key: text().notNull(),
    done: integer(),
});

export const setupVoidJobs = (database: Database): void => {
    database.$client.exec(`create table if not exists void_jobs (
        job_id integer primary key references jobs(id), key text not null, done integer
    )`);
};

export const voidJobStorageOptions: JobStorageOptions<VoidJobDefinition> = {
    kind: "test-void",
    inputSchema: Schema.Struct({ key: Schema.String }),
    outputSchema: Schema.Void,
    dedupKey: ({ key }) => key,
    insertInput: (database, jobId, input) => {
        database.insert(voidJobs).values({ jobId, key: input.key }).run();
    },
    readInput: (database, jobId) => {
        const row = database.select().from(voidJobs).where(eq(voidJobs.jobId, jobId)).get();
        return row === undefined ? undefined : { key: row.key };
    },
    saveResult: (database, job) => {
        database.update(voidJobs).set({ done: 1 }).where(eq(voidJobs.jobId, job.id)).run();
    },
    readResult: (database, jobId) => {
        const row = database.select().from(voidJobs).where(eq(voidJobs.jobId, jobId)).get();
        return row?.done === 1 ? Option.some(undefined) : Option.none();
    },
};

export const voidJobAdapter = defineJobStorageAdapter(voidJobStorageOptions);
