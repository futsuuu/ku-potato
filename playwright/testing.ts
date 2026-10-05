import { chromium, type Page } from "playwright-core";
import { Effect } from "effect";
import { defaultAuthenticationStoragePath } from "./mod.ts";
import { loginToLms } from "./login.ts";

export const storageStatePath = defaultAuthenticationStoragePath();
export const hasAuthenticationState = await Deno.stat(storageStatePath).then(
    () => true,
    (cause) => cause instanceof Deno.errors.NotFound ? false : Promise.reject(cause),
);

/** Uses saved application authentication without overwriting it. */
export function withAuthenticatedPage<A>(use: (page: Page) => Promise<A>): Promise<A> {
    return chromium.launch({
        channel: "chrome",
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
    }).then((browser) =>
        browser.newContext({ storageState: storageStatePath })
            .then((context) => context.newPage())
            .then((page) => Effect.runPromise(loginToLms(page, false)).then(() => use(page)))
            .finally(() => browser.close())
    );
}
