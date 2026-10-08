import { Effect, Scope } from "effect";
import { LmsAuthenticationStorageError } from "../core/out_port.ts";
import { authenticationStorageTry, parentDirectory } from "./authentication_storage.ts";
import { credentialSourcesStoragePath } from "./webauthn.ts";

const tryAcquire = Effect.fn("PlaywrightBrowser.tryAcquireAuthenticationLock")(function* (
    path: string,
): Effect.fn.Return<boolean, LmsAuthenticationStorageError, Scope.Scope> {
    yield* authenticationStorageTry(
        "create authentication lock directory",
        () => Deno.mkdir(parentDirectory(path), { recursive: true }),
    );
    const file = yield* authenticationStorageTry(
        "open authentication lock",
        () => Deno.open(path, { read: true, write: true, create: true }),
    );
    const acquired = yield* authenticationStorageTry("acquire authentication lock", () => file.tryLock(true)).pipe(
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

/** Never unlink this stable file. The OS releases its lock on process exit. */
export const withAuthenticationLock = <A, E, R>(
    storageStatePath: string,
    use: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | LmsAuthenticationStorageError, R> =>
    Effect.scoped(Effect.gen(function* () {
        while (!(yield* tryAcquire(`${credentialSourcesStoragePath(storageStatePath)}.lock`))) yield* Effect.sleep(50);
        return yield* use;
    }));
