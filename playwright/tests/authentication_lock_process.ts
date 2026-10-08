import { Effect } from "effect";
import { withAuthenticationLock } from "../authentication_lock.ts";

const [path, mode] = Deno.args;
await Effect.runPromise(withAuthenticationLock(
    path,
    Effect.gen(function* () {
        yield* Effect.sync(() => Deno.stdout.writeSync(new TextEncoder().encode("acquired\n")));
        if (mode === "hold") return yield* Effect.forever(Effect.sleep(1000));
    }),
));
