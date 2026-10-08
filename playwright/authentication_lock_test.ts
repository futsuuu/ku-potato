import { assert, assertEquals } from "@std/assert";
import { Deferred, Effect, Fiber } from "effect";
import { withAuthenticationLock } from "./authentication_lock.ts";
import { credentialSourcesStoragePath } from "./webauthn.ts";

Deno.test("authentication lock waits interruptibly and releases after failure or process death", async (t) => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-auth-lock-test-" });
    const path = `${directory}/state.json`;
    try {
        await t.step(
            "cookie paths sharing the same credentials serialize, and interrupted waiters never enter",
            async () => {
                const acquired = Deferred.makeUnsafe<void>();
                const release = Deferred.makeUnsafe<void>();
                let entered = false;
                const holder = Effect.runFork(
                    withAuthenticationLock(
                        path,
                        Deferred.succeed(acquired, undefined).pipe(Effect.andThen(Deferred.await(release))),
                    ),
                );
                await Effect.runPromise(Deferred.await(acquired));
                const waiter = Effect.runFork(
                    withAuthenticationLock(
                        `${directory}/other-cookie.json`,
                        Effect.sync(() => {
                            entered = true;
                        }),
                    ),
                );
                await Effect.runPromise(Effect.sleep(100));
                assertEquals(entered, false);
                await Effect.runPromise(Fiber.interrupt(waiter));
                await Effect.runPromise(Deferred.succeed(release, undefined));
                await Effect.runPromise(Fiber.join(holder));
                assertEquals(entered, false);
                await Effect.runPromise(withAuthenticationLock(path, Effect.void));
            },
        );
        await t.step("a failed operation releases its lock and preserves the stable file", async () => {
            const result = await Effect.runPromise(
                Effect.result(withAuthenticationLock(path, Effect.fail("expected"))),
            );
            assertEquals(result._tag, "Failure");
            await Effect.runPromise(withAuthenticationLock(path, Effect.void));
            assert((await Deno.stat(`${credentialSourcesStoragePath(path)}.lock`)).isFile);
        });
        await t.step("the OS releases the same stable lock when its owner is killed", async () => {
            const child = new Deno.Command(Deno.execPath(), {
                args: [
                    "run",
                    "--allow-all",
                    new URL("./tests/authentication_lock_process.ts", import.meta.url).pathname.replace(
                        /^\/([A-Za-z]:)/,
                        "$1",
                    ),
                    path,
                    "hold",
                ],
                stdout: "piped",
                stderr: "piped",
            }).spawn();
            try {
                const reader = child.stdout.getReader();
                assert(new TextDecoder().decode((await reader.read()).value).includes("acquired"));
                reader.releaseLock();
                child.kill("SIGKILL");
                await child.status;
                await Effect.runPromise(withAuthenticationLock(path, Effect.void).pipe(Effect.timeout(2000)));
            } finally {
                await child.output();
            }
        });
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});
