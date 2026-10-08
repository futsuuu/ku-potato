import { assert, assertEquals, assertRejects } from "@std/assert";
import { Deferred, Effect, ManagedRuntime } from "effect";
import { chromium } from "playwright-core";
import {
    LmsAuthenticationGateway,
    LmsAuthenticationStorageError,
    LmsSourceGateway,
    LmsSourceGatewayError,
} from "../../core/out_port.ts";
import { authenticateLmsPage, makeLmsGateways, makeLmsGatewaysLayer } from "../mod.ts";
import { credentialSourcesStoragePath, readStoredCredentialSources } from "../webauthn.ts";
import { interceptAuthentication, interceptRegistration, seedCredential } from "./authentication_fixture.ts";

Deno.test("authentication serializes credential counters across processes without serializing source callbacks", async (t) => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-auth-test-" });
    const state = `${directory}/state.json`;
    let active = 0;
    let peak = 0;
    const counters: number[] = [];
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request) => {
        active++;
        peak = Math.max(peak, active);
        counters.push(Number(new URL(request.url).searchParams.get("counter")));
        await Effect.runPromise(Effect.sleep(150));
        active--;
        return new Response("ok");
    });
    const coordinator = `http://127.0.0.1:${server.addr.port}`;
    let restore = () => {};
    let runtime: ReturnType<typeof ManagedRuntime.make<LmsSourceGateway | LmsAuthenticationGateway, never>> | undefined;
    try {
        await seedCredential(state);
        const initial = (await Effect.runPromise(readStoredCredentialSources(credentialSourcesStoragePath(state))))!;
        await t.step("three processes read each preceding saved counter", async () => {
            const children = Array.from({ length: 3 }, (_, index) =>
                new Deno.Command(Deno.execPath(), {
                    args: [
                        "run",
                        "--allow-all",
                        "--unsafe-proto",
                        new URL("./authentication_fixture.ts", import.meta.url).pathname.replace(
                            /^\/([A-Za-z]:)/,
                            "$1",
                        ),
                        `${directory}/state-${index}.json`,
                        coordinator,
                    ],
                    stdout: "piped",
                    stderr: "piped",
                }).output());
            for (const child of await Promise.all(children)) {
                assert(child.success, new TextDecoder().decode(child.stderr));
            }
            assertEquals(peak, 1);
            assertEquals(counters, [1, 2, 3].map((increment) => initial.credentials[0].signCount + increment));
        });
        restore = interceptAuthentication(coordinator);
        await t.step(
            "a blocked source callback releases authentication before use and never writes after logout",
            async () => {
                runtime = ManagedRuntime.make(makeLmsGatewaysLayer(state));
                const started = Deferred.makeUnsafe<void>();
                const release = Deferred.makeUnsafe<void>();
                const pending = runtime.runPromise(
                    Effect.flatMap(
                        LmsSourceGateway,
                        (source) =>
                            source.withSession(
                                "false",
                                () =>
                                    Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
                            ),
                    ),
                );
                try {
                    await Effect.runPromise(Deferred.await(started));
                    await Effect.runPromise(makeLmsGateways(state).authentication.login("false"));
                    await Effect.runPromise(makeLmsGateways(state).authentication.logout);
                    await Effect.runPromise(Deferred.succeed(release, undefined));
                    await pending;
                    await assertRejects(() => Deno.stat(state), Deno.errors.NotFound);
                    await assertRejects(() => Deno.stat(credentialSourcesStoragePath(state)), Deno.errors.NotFound);
                    assertEquals(
                        await runtime.runPromise(Effect.flatMap(LmsAuthenticationGateway, (auth) => auth.status)),
                        "unauthenticated",
                    );
                } finally {
                    await Effect.runPromise(Deferred.succeed(release, undefined));
                    await pending;
                    await runtime.dispose();
                    runtime = undefined;
                }
            },
        );
        await t.step(
            "failed authentication preserves the latest counter and cleanup permits another login",
            async () => {
                restore();
                await seedCredential(state);
                const before =
                    (await Effect.runPromise(readStoredCredentialSources(credentialSourcesStoragePath(state))))!;
                restore = interceptAuthentication(coordinator, true);
                await assertRejects(
                    () => Effect.runPromise(makeLmsGateways(state).authentication.login("false")),
                    LmsSourceGatewayError,
                );
                const after =
                    (await Effect.runPromise(readStoredCredentialSources(credentialSourcesStoragePath(state))))!;
                assertEquals(after.credentials[0].signCount, before.credentials[0].signCount + 1);
                restore();
                restore = interceptAuthentication(coordinator);
                await Effect.runPromise(makeLmsGateways(state).authentication.login("false"));
                assertEquals(
                    (await Effect.runPromise(readStoredCredentialSources(credentialSourcesStoragePath(state))))!
                        .credentials[0].signCount,
                    after.credentials[0].signCount + 1,
                );
            },
        );
        await t.step(
            "failed callback saves and detaches the authenticator before returning the original error",
            async () => {
                const browser = await chromium.launch({ channel: "chrome", headless: true });
                try {
                    const context = await browser.newContext();
                    let detached = 0;
                    let removed = 0;
                    const newSession = context.newCDPSession.bind(context);
                    context.newCDPSession = async (page) => {
                        const session = await newSession(page);
                        const detach = session.detach.bind(session);
                        const send = session.send.bind(session);
                        session.detach = async () => {
                            detached++;
                            await detach();
                        };
                        session.send = (...args) => {
                            if (args[0] === "WebAuthn.removeVirtualAuthenticator") removed++;
                            return send(...args);
                        };
                        return session;
                    };
                    const page = await context.newPage();
                    await assertRejects(
                        () =>
                            Effect.runPromise(authenticateLmsPage(context, true, page, state, false, () =>
                                Effect.fail(
                                    new LmsAuthenticationStorageError({
                                        operation: "test",
                                        message: "expected failure",
                                    }),
                                ))),
                        LmsAuthenticationStorageError,
                        "expected failure",
                    );
                    assertEquals(detached, 1);
                    assertEquals(removed, 1);
                } finally {
                    await browser.close();
                }
            },
        );
        await t.step("two simultaneous registration requests create only one credential", async () => {
            await Effect.runPromise(makeLmsGateways(state).authentication.logout);
            restore();
            const registration = interceptRegistration();
            restore = registration.restore;
            const results = await Promise.all([
                Effect.runPromise(
                    Effect.result(makeLmsGateways(state).authentication.registerWebAuthnCredential("false")),
                ),
                Effect.runPromise(
                    Effect.result(makeLmsGateways(state).authentication.registerWebAuthnCredential("false")),
                ),
            ]);
            assertEquals(results.map((result) => result._tag).sort(), ["Failure", "Success"]);
            const failure = results.find((result) => result._tag === "Failure")!;
            assertEquals(failure.failure._tag, "LmsAuthenticationStorageError");
            assertEquals(registration.submissions(), 1);
            assert(await Effect.runPromise(readStoredCredentialSources(credentialSourcesStoragePath(state))));
            const saved = JSON.parse(await Deno.readTextFile(state));
            assert(
                saved.cookies.some((cookie: { name: string; value: string }) =>
                    cookie.name === "registration" && cookie.value === "complete"
                ),
            );
        });
    } finally {
        await runtime?.dispose();
        restore();
        await server.shutdown();
        await Deno.remove(directory, { recursive: true });
    }
});
