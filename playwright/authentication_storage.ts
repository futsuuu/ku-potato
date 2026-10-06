import { Effect } from "effect";
import { LmsAuthenticationStorageError } from "../core/out_port.ts";
import { errorMessage } from "./promise.ts";

export function authenticationStorageTry<A>(operation: string, evaluate: () => PromiseLike<A>) {
    return Effect.tryPromise({
        try: evaluate,
        catch: (cause) => new LmsAuthenticationStorageError({ operation, message: errorMessage(cause) }),
    });
}

export const parentDirectory = (path: string): string => {
    const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    if (separatorIndex === -1) return ".";
    return separatorIndex === 2 && path[1] === ":" ? path.slice(0, separatorIndex + 1) : path.slice(0, separatorIndex);
};

export const readOptionalFile = (path: string) =>
    Deno.readTextFile(path).catch((cause) => cause instanceof Deno.errors.NotFound ? undefined : Promise.reject(cause));

/** Locks cookies and FIDO counters together across CLI and desktop processes. */
export function withAuthenticationLock<A, E, R>(path: string, operation: Effect.Effect<A, E, R>) {
    return Effect.scoped(Effect.gen(function* () {
        const lock = yield* Effect.acquireRelease(
            authenticationStorageTry("open authentication lock", async () => {
                await Deno.mkdir(parentDirectory(path), { recursive: true });
                return await Deno.open(`${path}.lock`, { read: true, write: true, create: true, mode: 0o600 });
            }),
            (file) => Effect.sync(() => file.close()),
        );
        yield* authenticationStorageTry("lock authentication state", () => lock.lock());
        return yield* operation;
    }));
}

/** Replace the complete secret file, so interruption cannot leave partial JSON. */
export async function writeAuthenticationFile(path: string, contents: string) {
    await Deno.mkdir(parentDirectory(path), { recursive: true });
    const temporaryPath = await Deno.makeTempFile({ dir: parentDirectory(path), prefix: ".auth-" });
    try {
        await Deno.writeTextFile(temporaryPath, contents, { mode: 0o600 });
        await Deno.rename(temporaryPath, path);
    } finally {
        await Deno.remove(temporaryPath).catch((cause) => {
            if (!(cause instanceof Deno.errors.NotFound)) throw cause;
        });
    }
}
