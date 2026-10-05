import { Effect } from "effect";
import { LmsSourceGatewayError } from "../core/out_port.ts";

export function tryPromise<A>(operation: string, evaluate: () => PromiseLike<A>) {
    return Effect.tryPromise({
        try: evaluate,
        catch: (cause) => new LmsSourceGatewayError({ operation, message: errorMessage(cause) }),
    });
}

export function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}
