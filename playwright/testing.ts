import { chromium, type Page } from "playwright-core";
import { Effect } from "effect";
import { defaultAuthenticationStoragePath } from "./mod.ts";
import { withAuthenticationLock } from "./authentication_lock.ts";
import { loginToLms } from "./login.ts";
import { createVirtualAuthenticator, credentialSourcesStoragePath, readStoredCredentialSources } from "./webauthn.ts";

export const storageStatePath = defaultAuthenticationStoragePath();
const liveTestsEnabled = Deno.env.get("KU_POTATO_LIVE_TESTS") === "1";
export const hasAuthenticationState = liveTestsEnabled && await Deno.stat(storageStatePath).then(
    () => true,
    (cause) => cause instanceof Deno.errors.NotFound ? false : Promise.reject(cause),
);

export const hasStoredCredentialSources = liveTestsEnabled &&
    await Deno.stat(credentialSourcesStoragePath(storageStatePath)).then(
        () => true,
        (cause) => cause instanceof Deno.errors.NotFound ? false : Promise.reject(cause),
    );

/** Leaves cookies unchanged, but persists credential signature counters. */
export function withAuthenticatedPage<A>(use: (page: Page) => Promise<A>, restoreCookies = true): Promise<A> {
    if (!liveTestsEnabled) {
        return Promise.reject(new Error("Set KU_POTATO_LIVE_TESTS=1 to run live authentication tests."));
    }
    return Effect.runPromise(withAuthenticationLock(
        storageStatePath,
        Effect.scoped(Effect.gen(function* () {
            const browser = yield* Effect.acquireRelease(
                Effect.promise(() =>
                    chromium.launch({
                        channel: "chrome",
                        headless: true,
                        args: ["--disable-blink-features=AutomationControlled"],
                    })
                ),
                (browser) => Effect.promise(() => browser.close()),
            );
            const context = yield* Effect.promise(() =>
                browser.newContext(restoreCookies ? { storageState: storageStatePath } : {})
            );
            const page = yield* Effect.promise(() => context.newPage());
            const path = credentialSourcesStoragePath(storageStatePath);
            const storedCredentialSources = yield* readStoredCredentialSources(path);
            if (storedCredentialSources) {
                yield* Effect.acquireRelease(
                    createVirtualAuthenticator(page, storedCredentialSources),
                    (authenticator) =>
                        authenticator.saveCredentialSources(path, storedCredentialSources.username).pipe(
                            Effect.orDie,
                            Effect.ensuring(authenticator.close.pipe(Effect.catch(Effect.logError))),
                        ),
                );
            }
            yield* loginToLms(page, false, storedCredentialSources?.username);
            return yield* Effect.promise(() => use(page));
        })),
    ));
}
