import { Effect } from "effect";
import type { Page } from "playwright-core";
import { LmsAuthenticationRequiredError, LmsSourceGatewayError } from "../core/out_port.ts";
import { isLmsHomeUrl, verifyLmsHome } from "./home.ts";
import { tryPromise } from "./promise.ts";

/** Logs in only from the identified login page and verifies the resulting home page. */
export const loginToLms = Effect.fn("PlaywrightBrowser.loginToLms")(function* (
    page: Page,
    allowInteraction: boolean,
    portalUsername?: string,
): Effect.fn.Return<void, LmsSourceGatewayError | LmsAuthenticationRequiredError> {
    yield* openLoginPage(page);
    yield* submitLogin(page);
    if (portalUsername && !isLmsHomeUrl(new URL(page.url()))) {
        yield* authenticateWithWebAuthn(page, portalUsername).pipe(
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

const authenticateWithWebAuthn = Effect.fn("PlaywrightBrowser.authenticateWithWebAuthn")(function* (
    page: Page,
    username: string,
) {
    const portalLogin = new URL(page.url()).pathname === "/sso/timeout.cgi";
    yield* Effect.gen(function* () {
        if (portalLogin) {
            yield* tryPromise(
                "authenticate with WebAuthn",
                () => page.goto("https://slink.secioss.com/user/?tenant=kogakuin.ac.jp"),
            );
        }
        if (new URL(page.url()).hostname !== "slink.secioss.com") return;
        yield* tryPromise("authenticate with WebAuthn", () => page.waitForLoadState("load"));
        const input = page.locator("#username_input[type='text']");
        if (yield* tryPromise("authenticate with WebAuthn", () => input.isVisible())) {
            // The tenant is supplied by KU-LMS; Secioss expects the local part here.
            yield* tryPromise("authenticate with WebAuthn", () => input.fill(username.split("@")[0]));
            yield* tryPromise("authenticate with WebAuthn", () => input.blur());
            yield* tryPromise(
                "authenticate with WebAuthn",
                () => page.locator("#login_button").click({ timeout: 15_000 }),
            );
            yield* tryPromise("authenticate with WebAuthn", () => page.waitForLoadState("load"));
        }
        if (
            yield* tryPromise(
                "authenticate with WebAuthn",
                () => page.locator("#password_input[type='password']").isVisible(),
            )
        ) {
            yield* tryPromise("authenticate with WebAuthn", () => page.locator("#back_link_select").click());
            yield* tryPromise("authenticate with WebAuthn", () => page.waitForLoadState("load"));
        }
        // Secioss retains the u2flogin value for its WebAuthn authentication option.
        const selection = page.locator("select[name='auth']");
        if (yield* tryPromise("authenticate with WebAuthn", () => selection.isVisible())) {
            yield* tryPromise("authenticate with WebAuthn", () => selection.selectOption("u2flogin"));
            yield* tryPromise("authenticate with WebAuthn", () => page.locator("#choice_button").click());
        }
        // Secioss invokes WebAuthn automatically when the FIDO page loads.
        yield* tryPromise("authenticate with WebAuthn", () =>
            page.waitForURL((url) =>
                isLmsHomeUrl(url) ||
                (portalLogin && url.hostname === "slink.secioss.com" &&
                    ["/user", "/user/", "/user/index.php"].includes(url.pathname)), { timeout: 30_000 }));
    }).pipe(
        Effect.mapError(() =>
            new LmsAuthenticationRequiredError({
                message: "保存済みのWebAuthnクレデンシャルでログインできませんでした。",
            })
        ),
    );
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
