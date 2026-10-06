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
