/** Outbound adapter for KU-LMS, implemented with Playwright. */
import {
    type HeadPolicy,
    LmsAuthenticationGateway,
    LmsAuthenticationStorageError,
    LmsSourceGateway,
} from "../core/out_port.ts";
import { Effect, Semaphore } from "effect";
import * as playwright from "playwright-core";
import { makeLmsSourceSession } from "./session.ts";
import { loginToLms } from "./login.ts";
import { tryPromise } from "./promise.ts";
import { authenticationStorageTry, parentDirectory } from "./authentication_storage.ts";
import { createVirtualAuthenticator, fidoStoragePath, readFidoState, registerFido } from "./fido.ts";

export { parseLmsCourseId } from "./home.ts";
export { parseLmsDate, parseLmsMaterialId, parseMaterialType, parsePublicationDeadline } from "./parsing.ts";

/** The default user-local location for Playwright authentication state. */
export const defaultAuthenticationStoragePath = (): string => {
    const localAppData = Deno.env.get("LOCALAPPDATA");
    return localAppData === undefined
        ? `${Deno.cwd()}/.ku-potato/auth/storage-state.json`
        : `${localAppData}/ku-potato/auth/storage-state.json`;
};

/** Creates an LMS source that opens one exclusive tab per operation. */
export const makeLmsSourceGateway = (storageStatePath = defaultAuthenticationStoragePath()) =>
    makeLmsGateways(storageStatePath).source;

/** Creates authentication operations backed by the same local browser state. */
export const makeLmsAuthenticationGateway = (storageStatePath = defaultAuthenticationStoragePath()) =>
    makeLmsGateways(storageStatePath).authentication;

/** Creates gateways that serialize browser use and persistent authentication updates. */
export const makeLmsGateways = (storageStatePath = defaultAuthenticationStoragePath()) => {
    const browserPermit = Semaphore.makeUnsafe(1);
    return {
        source: LmsSourceGateway.of({
            withSession: (headPolicy, use) =>
                browserPermit.withPermits(1)(
                    withAuthenticatedSession(storageStatePath, headPolicy, (page) => use(makeLmsSourceSession(page))),
                ),
        }),
        authentication: LmsAuthenticationGateway.of({
            login: (headPolicy) =>
                browserPermit.withPermits(1)(withAuthenticatedSession(storageStatePath, headPolicy, () => Effect.void)),
            registerFido: (headPolicy) =>
                browserPermit.withPermits(1)(Effect.gen(function* () {
                    const path = fidoStoragePath(storageStatePath);
                    if (yield* readFidoState(path)) {
                        return yield* new LmsAuthenticationStorageError({
                            operation: "register FIDO device",
                            message: "仮想FIDO認証器は保存済みです。auth loginでログインできます。",
                        });
                    }
                    yield* withAuthenticatedSession(storageStatePath, headPolicy, (page) =>
                        Effect.gen(function* () {
                            const authenticator = yield* createVirtualAuthenticator(page);
                            yield* registerFido(page, path, authenticator);
                        }));
                })),
            logout: browserPermit.withPermits(1)(
                Effect.forEach([storageStatePath, fidoStoragePath(storageStatePath)], removeAuthenticationState).pipe(
                    Effect.asVoid,
                ),
            ),
            status: browserPermit.withPermits(1)(withBrowserSession(storageStatePath, true, false, () => Effect.void))
                .pipe(
                    Effect.as("authenticated" as const),
                    Effect.catchTag("LmsAuthenticationRequiredError", () => Effect.succeed("unauthenticated" as const)),
                ),
        }),
    };
};

function withAuthenticatedSession<A, E, R>(
    storageStatePath: string,
    headPolicy: HeadPolicy,
    use: (page: playwright.Page) => Effect.Effect<A, E, R>,
) {
    switch (headPolicy) {
        case "true":
            return withBrowserSession(storageStatePath, false, true, use);
        case "false":
            return withBrowserSession(storageStatePath, true, false, use);
        case "auto":
            return withBrowserSession(storageStatePath, true, false, use).pipe(
                Effect.catchTag(
                    "LmsAuthenticationRequiredError",
                    () => withBrowserSession(storageStatePath, false, true, use),
                ),
            );
    }
}

function withBrowserSession<A, E, R>(
    storageStatePath: string,
    headless: boolean,
    allowInteraction: boolean,
    use: (page: playwright.Page) => Effect.Effect<A, E, R>,
) {
    return Effect.scoped(Effect.gen(function* () {
        const browser = yield* Effect.acquireRelease(
            tryPromise("launch browser", () => launchBrowser({ headless })),
            (browser) => tryPromise("close browser", () => browser.close()).pipe(Effect.catch(Effect.logError)),
        );
        const context = yield* Effect.acquireRelease(
            tryPromise("create browser context", () => browser.newContext()),
            (context) => tryPromise("close browser context", () => context.close()).pipe(Effect.catch(Effect.logError)),
        );
        yield* restoreAuthenticationState(context, storageStatePath);
        const page = yield* tryPromise("create browser page", () => context.newPage());
        const fidoPath = fidoStoragePath(storageStatePath);
        const fidoState = yield* readFidoState(fidoPath);
        let completed = false;
        const authenticator = fidoState
            ? yield* Effect.acquireRelease(
                createVirtualAuthenticator(page, fidoState),
                (authenticator) =>
                    completed ? Effect.void : authenticator.save(fidoPath, fidoState.username).pipe(Effect.orDie),
            )
            : undefined;
        const result = yield* Effect.result(Effect.gen(function* () {
            yield* loginToLms(page, allowInteraction, fidoState?.username);
            yield* saveAuthenticationState(context, storageStatePath);
            return yield* use(page);
        }));
        completed = true;
        if (authenticator && fidoState) {
            yield* authenticator.save(fidoPath, fidoState.username);
        }
        return yield* Effect.fromResult(result);
    }));
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

function launchBrowser(opts: { headless: boolean }) {
    return playwright.chromium.launch({
        channel: "chrome",
        headless: opts.headless,
        args: ["--disable-blink-features=AutomationControlled"],
    });
}
