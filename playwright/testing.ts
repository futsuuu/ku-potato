import { chromium, type Page } from "playwright-core";
import { Effect } from "effect";
import { defaultAuthenticationStoragePath } from "./mod.ts";
import { loginToLms } from "./login.ts";
import { createVirtualAuthenticator, fidoStoragePath, readFidoState } from "./fido.ts";

export const storageStatePath = defaultAuthenticationStoragePath();
export const hasAuthenticationState = await Deno.stat(storageStatePath).then(
    () => true,
    (cause) => cause instanceof Deno.errors.NotFound ? false : Promise.reject(cause),
);

export const hasFidoState = await Deno.stat(fidoStoragePath(storageStatePath)).then(
    () => true,
    (cause) => cause instanceof Deno.errors.NotFound ? false : Promise.reject(cause),
);

/** Leaves cookies unchanged, but persists FIDO counters. */
export function withAuthenticatedPage<A>(use: (page: Page) => Promise<A>, restoreCookies = true): Promise<A> {
    return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
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
        const path = fidoStoragePath(storageStatePath);
        const state = yield* readFidoState(path);
        if (state) {
            yield* Effect.acquireRelease(
                createVirtualAuthenticator(page, state),
                (authenticator) => authenticator.save(path, state.username).pipe(Effect.orDie),
            );
        }
        yield* loginToLms(page, false, state?.username);
        return yield* Effect.promise(() => use(page));
    })));
}
