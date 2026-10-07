/** Outbound adapter for KU-LMS, implemented with Playwright. */
import {
    type HeadPolicy,
    LmsAuthenticationGateway,
    LmsAuthenticationStorageError,
    LmsSourceGateway,
} from "../core/out_port.ts";
import { Context, Effect, Layer, Semaphore } from "effect";
import * as playwright from "playwright-core";
import { applicationDataPath } from "../platform/directories.ts";
import { makeLmsSourceSession } from "./session.ts";
import { loginToLms, resumeLmsSession } from "./login.ts";
import { authenticationStorageTry, parentDirectory } from "./authentication_storage.ts";
import { type BrowserSessionPool, makeBrowserSessionPool } from "./browser.ts";
import {
    createVirtualAuthenticator,
    credentialSourcesStoragePath,
    readStoredCredentialSources,
    registerWebAuthnCredential,
} from "./webauthn.ts";

export { parseLmsCourseId } from "./home.ts";
export { parseLmsDate, parseLmsMaterialId, parseMaterialType, parsePublicationDeadline } from "./parsing.ts";

/** The default user-local location for Playwright authentication state. */
export const defaultAuthenticationStoragePath = (): string => applicationDataPath("auth", "storage-state.json");

/** Creates an LMS source that opens one exclusive browser session per operation. */
export const makeLmsSourceGateway = (storageStatePath = defaultAuthenticationStoragePath()) =>
    makeLmsGateways(storageStatePath).source;

/** Creates authentication operations backed by the same local browser state. */
export const makeLmsAuthenticationGateway = (storageStatePath = defaultAuthenticationStoragePath()) =>
    makeLmsGateways(storageStatePath).authentication;

/** Creates gateways that serialize browser use and persistent authentication updates. */
export const makeLmsGateways = (storageStatePath = defaultAuthenticationStoragePath()) =>
    makeGateways(storageStatePath, makeBrowserSessionPool(false));

/** Reuses a successful browser, context, and page until the application's layer is disposed. */
export const makeLmsGatewaysLayer = (storageStatePath = defaultAuthenticationStoragePath()) =>
    Layer.effectContext(Effect.gen(function* () {
        const pool = yield* Effect.acquireRelease(
            Effect.sync(() => makeBrowserSessionPool()),
            (pool) => pool.close,
        );
        const gateways = makeGateways(storageStatePath, pool);
        return Context.make(LmsSourceGateway, gateways.source).pipe(
            Context.add(LmsAuthenticationGateway, gateways.authentication),
        );
    }));

function makeGateways(storageStatePath: string, pool: BrowserSessionPool) {
    const browserPermit = Semaphore.makeUnsafe(1);
    return {
        source: LmsSourceGateway.of({
            withSession: (headPolicy, use) =>
                browserPermit.withPermits(1)(
                    withAuthenticatedSession(
                        pool,
                        storageStatePath,
                        headPolicy,
                        (page) => use(makeLmsSourceSession(page)),
                    ),
                ),
        }),
        authentication: LmsAuthenticationGateway.of({
            login: (headPolicy) =>
                browserPermit.withPermits(1)(
                    withAuthenticatedSession(pool, storageStatePath, headPolicy, () => Effect.void),
                ),
            registerWebAuthnCredential: (headPolicy) =>
                browserPermit.withPermits(1)(Effect.gen(function* () {
                    const path = credentialSourcesStoragePath(storageStatePath);
                    if (yield* readStoredCredentialSources(path)) {
                        return yield* new LmsAuthenticationStorageError({
                            operation: "register WebAuthn credential",
                            message: "WebAuthnクレデンシャルソースは保存済みです。auth loginでログインできます。",
                        });
                    }
                    yield* withAuthenticatedSession(pool, storageStatePath, headPolicy, (page) =>
                        Effect.gen(function* () {
                            const authenticator = yield* Effect.acquireRelease(
                                createVirtualAuthenticator(page),
                                (authenticator) => authenticator.close.pipe(Effect.catch(Effect.logError)),
                            );
                            yield* registerWebAuthnCredential(page, path, authenticator);
                        }));
                })),
            logout: browserPermit.withPermits(1)(
                Effect.gen(function* () {
                    yield* pool.reset;
                    yield* Effect.forEach(
                        [storageStatePath, credentialSourcesStoragePath(storageStatePath)],
                        removeAuthenticationState,
                        { discard: true },
                    );
                }),
            ),
            status: browserPermit.withPermits(1)(
                withBrowserSession(pool, storageStatePath, undefined, false, () => Effect.void),
            )
                .pipe(
                    Effect.as("authenticated" as const),
                    Effect.catchTag("LmsAuthenticationRequiredError", () => Effect.succeed("unauthenticated" as const)),
                ),
        }),
    };
}

function withAuthenticatedSession<A, E, R>(
    pool: BrowserSessionPool,
    storageStatePath: string,
    headPolicy: HeadPolicy,
    use: (page: playwright.Page) => Effect.Effect<A, E, R>,
) {
    switch (headPolicy) {
        case "true":
            return withBrowserSession(pool, storageStatePath, false, true, use);
        case "false":
            return withBrowserSession(pool, storageStatePath, true, false, use);
        case "auto":
            return withBrowserSession(pool, storageStatePath, undefined, false, use).pipe(
                Effect.catchTag(
                    "LmsAuthenticationRequiredError",
                    () => withBrowserSession(pool, storageStatePath, false, true, use),
                ),
            );
    }
}

function withBrowserSession<A, E, R>(
    pool: BrowserSessionPool,
    storageStatePath: string,
    headless: boolean | undefined,
    allowInteraction: boolean,
    use: (page: playwright.Page) => Effect.Effect<A, E, R>,
) {
    return pool.withSession(headless, (context, fresh, page) =>
        Effect.scoped(Effect.gen(function* () {
            if (fresh) yield* restoreAuthenticationState(context, storageStatePath);
            const credentialSourcesPath = credentialSourcesStoragePath(storageStatePath);
            const storedCredentialSources = yield* readStoredCredentialSources(credentialSourcesPath);
            let completed = false;
            const authenticator = storedCredentialSources
                ? yield* Effect.acquireRelease(
                    createVirtualAuthenticator(page, storedCredentialSources),
                    (authenticator) =>
                        (completed ? Effect.void : authenticator.saveCredentialSources(
                            credentialSourcesPath,
                            storedCredentialSources.username,
                        )
                            .pipe(
                                Effect.orDie,
                            )).pipe(Effect.ensuring(authenticator.close.pipe(Effect.catch(Effect.logError)))),
                )
                : undefined;
            const result = yield* Effect.result(Effect.gen(function* () {
                yield* (fresh ? loginToLms : resumeLmsSession)(
                    page,
                    allowInteraction,
                    storedCredentialSources?.username,
                );
                yield* saveAuthenticationState(context, storageStatePath);
                const value = yield* use(page);
                yield* saveAuthenticationState(context, storageStatePath);
                return value;
            }));
            completed = true;
            if (authenticator && storedCredentialSources) {
                yield* authenticator.saveCredentialSources(credentialSourcesPath, storedCredentialSources.username);
            }
            return yield* Effect.fromResult(result);
        })));
}

const restoreAuthenticationState = Effect.fn("PlaywrightBrowser.restoreAuthenticationState")(function* (
    context: playwright.BrowserContext,
    storageStatePath: string,
) {
    const exists = yield* authenticationStorageTry("read authentication state", () =>
        Deno.stat(storageStatePath).then(
            () => true,
            (cause) => cause instanceof Deno.errors.NotFound ? false : Promise.reject(cause),
        ));
    if (exists) {
        yield* authenticationStorageTry(
            "restore authentication state",
            () => context.setStorageState(storageStatePath),
        );
    }
});

const saveAuthenticationState = Effect.fn("PlaywrightBrowser.saveAuthenticationState")(function* (
    context: playwright.BrowserContext,
    storageStatePath: string,
) {
    yield* authenticationStorageTry(
        "create authentication state directory",
        () => Deno.mkdir(parentDirectory(storageStatePath), { recursive: true }),
    );
    yield* authenticationStorageTry(
        "save authentication state",
        () => context.storageState({ path: storageStatePath }),
    );
});

function removeAuthenticationState(storageStatePath: string) {
    return authenticationStorageTry(
        "remove authentication state",
        () =>
            Deno.remove(storageStatePath).catch((cause) =>
                cause instanceof Deno.errors.NotFound ? undefined : Promise.reject(cause)
            ),
    );
}
