import { Effect } from "effect";
import type { Page } from "playwright-core";
import { LmsAuthenticationRequiredError, LmsSourceGatewayError } from "../core/out_port.ts";
import { isLmsHomeUrl, verifyLmsHome } from "./home.ts";
import { tryPromise } from "./promise.ts";

/** Logs in only from the identified login page and verifies the resulting home page. */
export const loginToLms = Effect.fn("PlaywrightBrowser.loginToLms")(function* (
    page: Page,
    allowInteraction: boolean,
    fidoUsername?: string,
): Effect.fn.Return<void, LmsSourceGatewayError | LmsAuthenticationRequiredError> {
    yield* openLoginPage(page);
    yield* submitLogin(page);
    if (fidoUsername && !isLmsHomeUrl(new URL(page.url()))) {
        yield* authenticateWithFido(page, fidoUsername).pipe(
            Effect.catchTag("LmsAuthenticationRequiredError", () => Effect.void),
        );
    }
    if (!isLmsHomeUrl(new URL(page.url()))) {
        if (!allowInteraction) {
            return yield* new LmsAuthenticationRequiredError({
                message: "Logging in to KU-LMS requires user interaction.",
            });
        }
        if (page.url().startsWith("https://slink.secioss.com/sso/timeout.cgi")) {
            yield* tryPromise("open SSO portal", () => page.goto("https://slink.secioss.com/user"));
            yield* tryPromise("wait for SSO login", () =>
                page.waitForURL((url) => {
                    const pathname = url.pathname;
                    return url.hostname === "slink.secioss.com" &&
                        (pathname === "/user" || pathname === "/user/" || pathname === "/user/index.php");
                }, { timeout: 10 * 60 * 1000 }));
            yield* openLoginPage(page);
            yield* submitLogin(page);
        }
        yield* tryPromise("wait for KU-LMS login", () => page.waitForURL(isLmsHomeUrl, { timeout: 10 * 60 * 1000 }));
    }
    yield* verifyLmsHome(page);
});

const authenticateWithFido = Effect.fn("PlaywrightBrowser.authenticateWithFido")(function* (
    page: Page,
    username: string,
) {
    const portalLogin = new URL(page.url()).pathname === "/sso/timeout.cgi";
    yield* Effect.tryPromise({
        try: async () => {
            if (portalLogin) await page.goto("https://slink.secioss.com/user/?tenant=kogakuin.ac.jp");
            if (new URL(page.url()).hostname !== "slink.secioss.com") return;
            await page.waitForLoadState("load");
            const input = page.locator("#username_input[type='text']");
            if (await input.isVisible()) {
                // The tenant is supplied by KU-LMS; Secioss expects the local part here.
                await input.fill(username.split("@")[0]);
                await input.blur();
                await page.locator("#login_button").click({ timeout: 15_000 });
                await page.waitForLoadState("load");
            }
            if (await page.locator("#password_input[type='password']").isVisible()) {
                await page.locator("#back_link_select").click();
                await page.waitForLoadState("load");
            }
            const selection = page.locator("select[name='auth']");
            if (await selection.isVisible()) {
                await selection.selectOption("u2flogin");
                await page.locator("#choice_button").click();
            }
            // Secioss invokes WebAuthn automatically when the FIDO page loads.
            await page.waitForURL((url) =>
                isLmsHomeUrl(url) ||
                (portalLogin && url.hostname === "slink.secioss.com" &&
                    ["/user", "/user/", "/user/index.php"].includes(url.pathname)), { timeout: 30_000 });
        },
        catch: () =>
            new LmsAuthenticationRequiredError({ message: "保存済みのFIDO認証器でログインできませんでした。" }),
    });
    if (portalLogin) {
        yield* openLoginPage(page);
        yield* submitLogin(page);
    }
});

const submitLogin = Effect.fn("PlaywrightBrowser.submitLogin")(function* (page: Page) {
    yield* tryPromise("click KU-LMS login", () => page.locator("button[name='loginButton']").click());
    // Clicking waits for the first navigation, but SSO can continue through an intermediate origin.
    yield* tryPromise("wait for KU-LMS authentication redirect", () =>
        page.waitForURL((url) =>
            isLmsHomeUrl(url) ||
            (url.protocol === "https:" && url.hostname === "slink.secioss.com" &&
                [
                    "/sso/timeout.cgi",
                    "/pub/prelogin.cgi",
                    "/pub/login.cgi",
                    "/pub/u2flogin.cgi",
                    "/user/authselect.php",
                    "/user",
                    "/user/",
                    "/user/index.php",
                ].includes(url.pathname))
        ));
});

const openLoginPage = Effect.fn("PlaywrightBrowser.openLoginPage")(function* (page: Page) {
    yield* tryPromise("open KU-LMS", () => page.goto("https://study.ns.kogakuin.ac.jp/lms"));
    // This instruction identifies the page independently of the button being clicked.
    yield* tryPromise(
        "verify KU-LMS login page",
        () => page.getByText("統合認証アカウントでログインします", { exact: true }).waitFor(),
    );
});
