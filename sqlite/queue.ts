import { and, eq, gt, lte, sql } from "drizzle-orm";
import { Crypto, DateTime, Effect, Layer, Option, Scope } from "effect";
import { DenoCrypto } from "@effect/platform-deno";
import {
    type ApplicationJobDefinition,
    type Job,
    type JobDefinition,
    JobQueue,
    type JobQueueService,
    LmsArchiveGatewayError,
} from "../core/out_port.ts";
import { type Database, defaultArchiveDatabasePath, openArchiveDatabase } from "./mod.ts";
import { jobs } from "./schema.ts";
import { type JobStorageAdapter, type JobTransaction } from "./job_storage.ts";
import { describeSqliteCause, isSqliteBusy, sqliteTry } from "./errors.ts";

const now = () => DateTime.toEpochMillis(DateTime.nowUnsafe());
const queueTry = <A>(operation: string, use: () => A): Effect.Effect<A, LmsArchiveGatewayError> =>
    sqliteTry(use).pipe(
        Effect.mapError(({ cause }) => new LmsArchiveGatewayError({ operation, message: describeSqliteCause(cause) })),
    );
const fence = (job: Job<JobDefinition>, at: number) =>
    and(
        eq(jobs.id, job.id),
        eq(jobs.kind, job.kind),
        eq(jobs.status, "running"),
        eq(jobs.ownerId, job.ownerId ?? ""),
        eq(jobs.leaseToken, job.leaseToken ?? ""),
        gt(jobs.leaseUntil, at),
    );
const release = { ownerId: null, leaseToken: null, leaseUntil: null };
// oxlint-disable-next-line effecttsgo/extends-native-error -- Private transaction rollback signal.
class LeaseExpiredDuringCommit extends Error {}

const makeQueue = <D extends JobDefinition>(
    database: Database,
    adapters: readonly JobStorageAdapter<D>[],
): JobQueueService<D> => {
    const registry = new Map<string, JobStorageAdapter<D>>();
    for (const adapter of adapters) {
        if (registry.has(adapter.kind)) throw new Error(`Duplicate job kind: ${adapter.kind}.`);
        registry.set(adapter.kind, adapter);
    }
    const adapterFor = (kind: string) => {
        const adapter = registry.get(kind);
        if (adapter === undefined) throw new Error(`Unregistered job kind: ${kind}.`);
        return adapter;
    };
    const decode = (connection: JobTransaction, row: typeof jobs.$inferSelect): Job<D> => ({
        id: row.id,
        kind: row.kind,
        input: adapterFor(row.kind).readInput(connection, row.id),
        status: row.status,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        ...(row.ownerId === null ? {} : { ownerId: row.ownerId }),
        ...(row.leaseToken === null ? {} : { leaseToken: row.leaseToken }),
        ...(row.leaseUntil === null ? {} : { leaseUntil: row.leaseUntil }),
        ...(row.lastError === null ? {} : { lastError: row.lastError }),
        ...(row.errorTag === null ? {} : { errorTag: row.errorTag }),
    } as Job<D>);
    const rowFor = (id: number, kind: string) => {
        adapterFor(kind);
        const row = database.select().from(jobs).where(eq(jobs.id, id)).get();
        if (row !== undefined && row.kind !== kind) {
            throw new Error(`Job ${id} has kind ${row.kind}; requested ${kind}.`);
        }
        return row;
    };
    return {
        enqueue: (request) =>
            queueTry("enqueue job", () =>
                database.transaction<{ value: Job<D> }>((transaction) => {
                    const adapter = adapterFor(request.kind);
                    const input = adapter.validateInput(request.input);
                    const dedupKey = adapter.dedupKey(input);
                    const active = transaction.select().from(jobs).where(
                        and(
                            eq(jobs.kind, request.kind),
                            eq(jobs.dedupKey, dedupKey),
                            sql`${jobs.status} in ('queued', 'running')`,
                        ),
                    ).get();
                    if (active !== undefined) return { value: decode(transaction, active) };
                    const row = transaction.insert(jobs).values({
                        kind: request.kind,
                        dedupKey,
                        status: "queued",
                        availableAt: now(),
                        maxAttempts: adapter.maxAttempts,
                    }).returning().get()!;
                    adapter.insertInput(transaction, row.id, input);
                    return { value: decode(transaction, row) };
                }, { behavior: "immediate" }).value as Job<Extract<D, { kind: typeof request.kind }>>),
        get: (id, kind) =>
            queueTry("read job", () => {
                const row = rowFor(id, kind);
                return row === undefined ? undefined : decode(database, row) as Job<Extract<D, { kind: typeof kind }>>;
            }),
        claim: (ownerId, leaseMs) =>
            Effect.gen(function* () {
                const leaseToken = yield* Crypto.Crypto.use((service) => service.randomUUIDv4).pipe(
                    Effect.provide(DenoCrypto.layer),
                    Effect.mapError((error) =>
                        new LmsArchiveGatewayError({ operation: "create lease token", message: error.message })
                    ),
                );
                return yield* queueTry("claim job", () =>
                    database.transaction<{ value: Job<D> | undefined }>((transaction) => {
                        const at = now();
                        transaction.update(jobs).set({
                            ...release,
                            status: "failed",
                            lastError: "Worker lease expired after its maximum attempts.",
                            errorTag: "LmsSourceGatewayError",
                        })
                            .where(
                                and(
                                    eq(jobs.status, "running"),
                                    lte(jobs.leaseUntil, at),
                                    sql`${jobs.attempts} >= ${jobs.maxAttempts}`,
                                ),
                            ).run();
                        transaction.update(jobs).set({ ...release, status: "queued", availableAt: at })
                            .where(and(eq(jobs.status, "running"), lte(jobs.leaseUntil, at))).run();
                        while (true) {
                            const candidate = transaction.select().from(jobs).where(
                                and(eq(jobs.status, "queued"), lte(jobs.availableAt, at)),
                            ).orderBy(jobs.id).limit(1).get();
                            if (candidate === undefined) {
                                return { value: undefined };
                            }
                            let decoded: Job<D>;
                            try {
                                decoded = decode(transaction, candidate);
                            } catch (cause) {
                                if (isSqliteBusy(cause)) {
                                    throw cause;
                                }
                                transaction.update(jobs).set({
                                    ...release,
                                    status: "failed",
                                    lastError: describeSqliteCause(cause),
                                    errorTag: "InvalidJob",
                                }).where(eq(jobs.id, candidate.id)).run();
                                continue;
                            }
                            const row = transaction.update(jobs).set({
                                status: "running",
                                ownerId,
                                leaseToken,
                                leaseUntil: at + leaseMs,
                                attempts: candidate.attempts + 1,
                            })
                                .where(eq(jobs.id, candidate.id)).returning().get()!;
                            return {
                                value: {
                                    ...decoded,
                                    status: row.status,
                                    attempts: row.attempts,
                                    ownerId,
                                    leaseToken,
                                    leaseUntil: row.leaseUntil!,
                                } as Job<D>,
                            };
                        }
                    }, { behavior: "immediate" }).value);
            }),
        heartbeat: (job, leaseMs) =>
            queueTry("renew job lease", () =>
                database.transaction((transaction) => {
                    const at = now();
                    return transaction.update(jobs).set({ leaseUntil: at + leaseMs }).where(fence(job, at))
                        .returning({ id: jobs.id }).all().length === 1;
                }, { behavior: "immediate" })),
        complete: ({ job, output }) =>
            queueTry("complete job", () => {
                try {
                    return database.transaction((transaction) => {
                        const row = transaction.select().from(jobs).where(fence(job, now())).get();
                        if (row === undefined) return false;
                        // Recover persisted input instead of trusting the caller's job object.
                        const adapter = adapterFor(row.kind);
                        adapter.saveResult(transaction, decode(transaction, row), output);
                        if (Option.isNone(adapter.readResult(transaction, row.id))) {
                            throw new Error(`Job ${row.id} (${row.kind}) has no stored result after saving.`);
                        }
                        const changed = transaction.update(jobs).set({
                            ...release,
                            status: "succeeded",
                            lastError: null,
                            errorTag: null,
                        }).where(fence(job, now())).returning({ id: jobs.id }).all();
                        if (changed.length !== 1) throw new LeaseExpiredDuringCommit();
                        return true;
                    }, { behavior: "immediate" });
                } catch (cause) {
                    if (cause instanceof LeaseExpiredDuringCommit) return false;
                    throw cause;
                }
            }),
        fail: (job, error, retryDelayMs) =>
            queueTry("fail job", () =>
                database.transaction((transaction) => {
                    const at = now();
                    const row = transaction.select().from(jobs).where(fence(job, at)).get();
                    if (row === undefined) return false;
                    const status = error.blocked
                        ? "blocked"
                        : error.retry && row.attempts < row.maxAttempts
                        ? "queued"
                        : "failed";
                    return transaction.update(jobs).set({
                        ...release,
                        status,
                        availableAt: at + retryDelayMs,
                        lastError: error.message,
                        errorTag: error.tag,
                    }).where(fence(job, at)).returning({ id: jobs.id }).all().length === 1;
                }, { behavior: "immediate" })),
        result: (id, kind) =>
            queueTry("read job result", () => {
                const row = rowFor(id, kind);
                if (row?.status !== "succeeded") return Option.none();
                const output = adapterFor(kind).readResult(database, id);
                if (Option.isNone(output)) throw new Error(`Succeeded job ${id} (${kind}) has no stored result.`);
                return output as Option.Option<Extract<D, { kind: typeof kind }>["output"]>;
            }),
    };
};

/** Lazily opens one scoped connection while retaining operation-specific kind/input/output types. */
export const makeJobQueue = <D extends JobDefinition>(
    adapters: readonly JobStorageAdapter<D>[],
    databasePath = defaultArchiveDatabasePath(),
): Effect.Effect<JobQueueService<D>, never, Scope.Scope> =>
    Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const cached = yield* Effect.cached(
            openArchiveDatabase(databasePath).pipe(
                Effect.flatMap((database) => queueTry("register job kinds", () => makeQueue(database, adapters))),
                Effect.provideService(Scope.Scope, scope),
            ),
        );
        const queue: JobQueueService<D> = {
            enqueue: (...args) => cached.pipe(Effect.flatMap((queue) => queue.enqueue(...args))),
            get: (...args) => cached.pipe(Effect.flatMap((queue) => queue.get(...args))),
            claim: (...args) => cached.pipe(Effect.flatMap((queue) => queue.claim(...args))),
            heartbeat: (...args) => cached.pipe(Effect.flatMap((queue) => queue.heartbeat(...args))),
            complete: (...args) => cached.pipe(Effect.flatMap((queue) => queue.complete(...args))),
            fail: (...args) => cached.pipe(Effect.flatMap((queue) => queue.fail(...args))),
            result: (...args) => cached.pipe(Effect.flatMap((queue) => queue.result(...args))),
        };
        return queue;
    });

export const makeJobQueueLayer = (
    adapters: readonly JobStorageAdapter<ApplicationJobDefinition>[],
    databasePath = defaultArchiveDatabasePath(),
) => Layer.effect(JobQueue, makeJobQueue(adapters, databasePath));
