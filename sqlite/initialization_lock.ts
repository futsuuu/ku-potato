import { Effect, Scope } from "effect";
import { LmsArchiveGatewayError } from "../core/out_port.ts";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- SQLite lock files use native filesystem paths.
import { dirname } from "node:path";

const lockTry = <A>(operation: string, use: () => Promise<A>) =>
    Effect.tryPromise({
        try: use,
        catch: (cause) =>
            new LmsArchiveGatewayError({
                operation,
                message: cause instanceof Error ? cause.message : String(cause),
            }),
    });

const tryAcquire = Effect.fn("Sqlite.tryAcquireInitializationLock")(function* (
    path: string,
): Effect.fn.Return<boolean, LmsArchiveGatewayError, Scope.Scope> {
    yield* lockTry("create initialization lock directory", () => Deno.mkdir(dirname(path), { recursive: true }));
    const file = yield* lockTry("open initialization lock", () =>
        Deno.open(path, {
            read: true,
            write: true,
            create: true,
        }));
    const acquired = yield* lockTry("acquire initialization lock", () => file.tryLock(true)).pipe(
        Effect.catch((error) => {
            file.close();
            return error;
        }),
    );
    if (!acquired) {
        file.close();
        return false;
    }
    yield* Effect.addFinalizer(() => Effect.sync(() => file.close()));
    return true;
}, Effect.uninterruptible);

/** Serialize migration setup only. Stable files remain; the OS releases locks after exit. */
export const withInitializationLock = <A, E, R>(
    path: string,
    use: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | LmsArchiveGatewayError, R> =>
    Effect.scoped(Effect.gen(function* () {
        while (!(yield* tryAcquire(path))) yield* Effect.sleep(50);
        return yield* use;
    }));
