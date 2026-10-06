import { assertEquals } from "@std/assert";
import { Effect } from "effect";
import { chromium } from "playwright-core";
import { loginToLms } from "./login.ts";
import { hasAuthenticationState, hasFidoState, withAuthenticatedPage } from "./testing.ts";

Deno.test({
    name: "KU-LMS login reaches the verified home page using the application's saved authentication",
    ignore: !hasAuthenticationState,
    async fn() {
        await withAuthenticatedPage(async (page) => {
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
        });
    },
});

Deno.test("Automatic FIDO login handles username entry, remembered password selection, and SSO timeout", async (t) => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    const origin = "https://slink.secioss.com";
    const home = "https://study.ns.kogakuin.ac.jp/lms/homeHoml/doIndex";
    try {
        for (const entry of ["/pub/prelogin.cgi", "/pub/login.cgi", "/sso/timeout.cgi"]) {
            await t.step(entry, async () => {
                const context = await browser.newContext();
                try {
                    let portalAuthenticated = false;
                    await context.route("https://study.ns.kogakuin.ac.jp/**", (route) =>
                        route.fulfill({
                            contentType: "text/html; charset=utf-8",
                            body: new URL(route.request().url()).pathname === new URL(home).pathname
                                ? '<span class="lms-search-condition-title">講義一覧</span><div class="lms-weekly-area">Courses</div>'
                                : `<p>統合認証アカウントでログインします</p><form action="${
                                    portalAuthenticated ? home : origin + entry
                                }"><button name="loginButton">Login</button></form>`,
                        }));
                    await context.route(`${origin}/**`, (route) => {
                        const url = new URL(route.request().url());
                        let body = "";
                        switch (url.pathname) {
                            case "/pub/prelogin.cgi":
                            case "/user/":
                                body =
                                    `<form action="${origin}/user/authselect.php"><input id="username_input" name="username" type="text"><button id="login_button">Next</button></form>`;
                                break;
                            case "/pub/login.cgi":
                                body =
                                    `<input id="password_input" type="password"><a id="back_link_select" href="${origin}/user/authselect.php">Back</a>`;
                                break;
                            case "/user/authselect.php":
                                if (entry === "/pub/prelogin.cgi") {
                                    assertEquals(url.searchParams.get("username"), "test");
                                }
                                body =
                                    `<form action="${origin}/pub/u2flogin.cgi"><select name="auth"><option value="login">Password</option><option value="u2flogin">FIDO</option></select><button id="choice_button">Select</button></form>`;
                                break;
                            case "/pub/u2flogin.cgi":
                                assertEquals(url.searchParams.get("auth"), "u2flogin");
                                body = `<script>location.href='${
                                    entry === "/sso/timeout.cgi" ? origin + "/user/index.php" : home
                                }'</script>`;
                                break;
                            case "/user/index.php":
                                portalAuthenticated = true;
                                body = "Portal";
                                break;
                        }
                        return route.fulfill({ contentType: "text/html; charset=utf-8", body });
                    });
                    const page = await context.newPage();
                    await Effect.runPromise(loginToLms(page, false, "test@kogakuin.ac.jp"));
                    assertEquals(new URL(page.url()).pathname, new URL(home).pathname);
                } finally {
                    await context.close();
                }
            });
        }
    } finally {
        await browser.close();
    }
});

Deno.test({
    name: "KU-LMS login succeeds using registered FIDO credentials without saved cookies",
    ignore: !hasFidoState,
    async fn() {
        await withAuthenticatedPage(async (page) => {
            assertEquals(new URL(page.url()).hostname, "study.ns.kogakuin.ac.jp");
            assertEquals(new URL(page.url()).pathname.split(";")[0], "/lms/homeHoml/doIndex");
            assertEquals(await page.locator(".lms-weekly-area").isVisible(), true);
        }, false);
    },
});
