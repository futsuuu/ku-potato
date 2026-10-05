import { assertEquals } from "@std/assert";
import { Effect } from "effect";
import { chromium } from "playwright-core";
import { loginToLms } from "./login.ts";
import { defaultAuthenticationStoragePath } from "./mod.ts";

const storageStatePath = defaultAuthenticationStoragePath();
const hasAuthenticationState = await Deno.stat(storageStatePath).then(
    () => true,
    (cause) => cause instanceof Deno.errors.NotFound ? false : Promise.reject(cause),
);

Deno.test({
    name: "KU-LMS login reaches the verified home page using the application's saved authentication",
    ignore: !hasAuthenticationState,
    async fn() {
        const browser = await chromium.launch({
            channel: "chrome",
            headless: true,
            args: ["--disable-blink-features=AutomationControlled"],
        });
        try {
            const context = await browser.newContext({ storageState: storageStatePath });
            const page = await context.newPage();
            await Effect.runPromise(loginToLms(page, false));

            const url = new URL(page.url());
            assertEquals(url.hostname, "study.ns.kogakuin.ac.jp");
            assertEquals(url.pathname.split(";")[0], "/lms/homeHoml/doIndex");
            assertEquals(
                await page.locator(".lms-search-condition-title").getByText("講義一覧", { exact: true }).isVisible(),
                true,
            );
            assertEquals(await page.locator(".lms-weekly-area").isVisible(), true);
            assertEquals(
                await page.getByText("統合認証アカウントでログインします", { exact: true }).isVisible(),
                false,
            );
        } finally {
            await browser.close();
        }
    },
});
