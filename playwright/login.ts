import { Effect } from "effect";
import type { Page } from "playwright-core";
import { LmsAuthenticationRequiredError, LmsSourceGatewayError } from "../core/out_port.ts";
import { isLmsHomeUrl, verifyLmsHome } from "./home.ts";
import { tryPromise } from "./promise.ts";

/** Logs in only from the identified login page and verifies the resulting home page. */
export const loginToLms = Effect.fn("PlaywrightBrowser.loginToLms")(function* (
    page: Page,
    allowInteraction: boolean,
): Effect.fn.Return<void, LmsSourceGatewayError | LmsAuthenticationRequiredError> {
    yield* openLoginPage(page);
    yield* submitLogin(page);
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

const submitLogin = Effect.fn("PlaywrightBrowser.submitLogin")(function* (page: Page) {
    yield* tryPromise("click KU-LMS login", () => page.locator("button[name='loginButton']").click());
    // Clicking waits for the first navigation, but SSO can continue through an intermediate origin.
    yield* tryPromise("wait for KU-LMS authentication redirect", () =>
        page.waitForURL((url) =>
            isLmsHomeUrl(url) ||
            (url.protocol === "https:" && url.hostname === "slink.secioss.com" &&
                ["/sso/timeout.cgi", "/pub/prelogin.cgi", "/user", "/user/", "/user/index.php"].includes(url.pathname))
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
