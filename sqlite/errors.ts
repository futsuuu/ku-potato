import { Effect, Predicate, Schedule, Schema } from "effect";

class SqliteFailure extends Schema.TaggedError<SqliteFailure>()("SqliteFailure", { cause: Schema.Defect() }) {}

const causeChain = function* (cause: unknown): Generator<unknown> {
    const seen = new Set<unknown>();
    while (!seen.has(cause)) {
        seen.add(cause);
        yield cause;
        if (!Predicate.isObject(cause) || !("cause" in cause) || cause.cause === undefined) return;
        cause = cause.cause;
    }
};

/** Drizzle wraps SQLite failures; classify the driver error rather than query text or parameters. */
export const isSqliteBusy = (cause: unknown): boolean => {
    for (const error of causeChain(cause)) {
        if (!Predicate.isObject(error) || !("code" in error)) continue;
        if (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED") return true;
        if (error.code !== "ERR_SQLITE_ERROR") continue;
        if ("errcode" in error && typeof error.errcode === "number") {
            // Extended SQLite result codes retain their primary code in the low byte.
            return (error.errcode & 0xff) === 5 || (error.errcode & 0xff) === 6;
        }
        // Deno's node:sqlite currently supplies no numeric SQLite result code.
        if (
            error instanceof Error &&
            /^database(?: table| schema)? is (?:locked|busy)(?:: .+)?$/i.test(error.message)
        ) return true;
    }
    return false;
};

export const describeSqliteCause = (cause: unknown): string =>
    Array.from(causeChain(cause), (error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!Predicate.isObject(error) || !("code" in error)) return message;
        const code = "errcode" in error ? `${String(error.code)}:${String(error.errcode)}` : String(error.code);
        return `${message} [${code}]`;
    }).join("; caused by: ");

/** Keep the original driver cause until the bounded retry decision has been made. */
export const sqliteTry = <A>(evaluate: () => A): Effect.Effect<A, SqliteFailure> =>
    Effect.try({ try: evaluate, catch: (cause) => new SqliteFailure({ cause }) }).pipe(Effect.retry({
        times: 4,
        schedule: Schedule.spaced("50 millis"),
        while: (error) => isSqliteBusy(error.cause),
    }));
