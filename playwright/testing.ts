import { chromium, type Page } from "playwright-core";
import { Effect } from "effect";
import { defaultAuthenticationStoragePath } from "./mod.ts";
import { loginToLms } from "./login.ts";
import { withAuthenticationLock } from "./authentication_storage.ts";
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

/** Leaves cookies unchanged, but persists FIDO counters under the application lock. */
export function withAuthenticatedPage<A>(use: (page: Page) => Promise<A>, restoreCookies = true): Promise<A> {
    return Effect.runPromise(withAuthenticationLock(
        storageStatePath,
        Effect.promise(async () => {
            const browser = await chromium.launch({
                channel: "chrome",
                headless: true,
                args: ["--disable-blink-features=AutomationControlled"],
            });
            try {
                const context = await browser.newContext(restoreCookies ? { storageState: storageStatePath } : {});
                const page = await context.newPage();
                const path = fidoStoragePath(storageStatePath);
                const state = await Effect.runPromise(readFidoState(path));
                const authenticator = state ? await createVirtualAuthenticator(page, state) : undefined;
                try {
                    await Effect.runPromise(loginToLms(page, false, state?.username));
                    return await use(page);
                } finally {
                    if (authenticator && state) await authenticator.save(path, state.username);
                }
            } finally {
                await browser.close();
            }
        }),
    ));
}
