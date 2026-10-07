import { assert, assertEquals, assertRejects } from "@std/assert";
import { Deferred, Effect, ManagedRuntime } from "effect";
import { type Browser, type BrowserContext, chromium } from "playwright-core";
import { LmsAuthenticationGateway, LmsSourceGateway, LmsSourceGatewayError } from "../../core/out_port.ts";
import { makeLmsGatewaysLayer } from "../mod.ts";
import { LmsCourseId } from "../../domain/mod.ts";

Deno.test("scoped gateways reuse contexts without stale source data and dispose on logout or shutdown", async (t) => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-reuse-test-" });
    const storagePath = `${directory}/storage-state.json`;
    const launch = chromium.launch.bind(chromium);
    const browsers: Browser[] = [];
    const contexts: BrowserContext[] = [];
    const modes: (boolean | undefined)[] = [];
    const loginCookies: (string | undefined)[] = [];
    const homeCookies: (string | undefined)[] = [];
    const homeRequests: string[] = [];
    let expiredDestination: string | undefined;
    let loginAtHome = false;
    let version = 0;
    let requiresInteraction = false;
    let failNextContext = false;
    const homeUrl = "https://study.ns.kogakuin.ac.jp/lms/homeHoml/doIndex";
    // Intercept only this test's browser launches; all site responses stay local.
    chromium.launch = async (options) => {
        modes.push(options?.headless);
        const browser = await launch.call(chromium, { ...options, headless: true });
        browsers.push(browser);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (options) => {
            if (failNextContext) {
                failNextContext = false;
                throw new Error("Expected context creation failure.");
            }
            const context = await newContext(options);
            contexts.push(context);
            context.on("page", (page) => {
                page.setDefaultTimeout(1500);
                page.setDefaultNavigationTimeout(1500);
            });
            await context.route("**/*", (route) => {
                const url = route.request().url();
                const pathname = new URL(url).pathname;
                if (pathname === "/lms/homeRedirect/") {
                    homeRequests.push(url);
                    homeCookies.push(route.request().headers().cookie);
                    const location = expiredDestination ?? homeUrl;
                    expiredDestination = undefined;
                    return route.fulfill({
                        contentType: "text/html",
                        body: `<script>location.replace('${location}')</script>`,
                    });
                }
                if (url === "https://study.ns.kogakuin.ac.jp/lms" || pathname === "/lms/lginLgir/") {
                    loginCookies.push(route.request().headers().cookie);
                    const destination = requiresInteraction && modes.at(-1) !== false
                        ? "https://slink.secioss.com/pub/prelogin.cgi"
                        : homeUrl;
                    return route.fulfill({
                        contentType: "text/html; charset=utf-8",
                        body: `<p>統合認証アカウントでログインします</p>
                            <form action="${destination}"><button name="loginButton">ログイン</button></form>`,
                    });
                }
                if (pathname === "/lms/homeHoml/doIndex" && loginAtHome) {
                    loginAtHome = false;
                    return route.fulfill({
                        contentType: "text/html; charset=utf-8",
                        body: "<p>統合認証アカウントでログインします</p>",
                    });
                }
                if (pathname === "/lms/homeHoml/doLinkKougi") {
                    return route.fulfill({
                        contentType: "text/html; charset=utf-8",
                        body: '<p>授業が登録されていません。</p><a href="/lms/homeRedirect/?from=menu">HOME</a>',
                    });
                }
                return route.fulfill({
                    contentType: "text/html; charset=utf-8",
                    headers: { "set-cookie": `session=v${version}; Path=/; Secure` },
                    body: new URL(url).pathname === "/lms/homeHoml/doIndex"
                        ? `<div class="lms-search-condition-title"><span>講義一覧</span></div>
                            <div class="lms-weekly-area"><div class="lms-cardname">
                            <a href="/lms/homeHoml/doLinkKougi" onclick="formSubmit('KOG1')">Course v${version}</a>
                            </div></div><a href="/lms/homeRedirect/?from=menu">HOME</a>
                            <script>function formSubmit() {}</script>`
                        : "<p>Authentication required</p>",
                });
            });
            return context;
        };
        return browser;
    };
    let runtime = ManagedRuntime.make(makeLmsGatewaysLayer(storagePath));
    const fetch = Effect.gen(function* () {
        const source = yield* LmsSourceGateway;
        return yield* source.withSession("auto", (session) => session.fetchCourses);
    });
    try {
        await t.step("repeated refreshes reuse the page and context while rebuilding source indexes", async () => {
            assertEquals((await runtime.runPromise(fetch))[0].name, "Course v0");
            assertEquals(browsers.length, 1);
            assertEquals(contexts.length, 1);
            assertEquals(contexts[0].pages().length, 1);
            const page = contexts[0].pages()[0];
            assert(browsers[0].isConnected());
            version++;
            assertEquals((await runtime.runPromise(fetch))[0].name, "Course v1");
            assertEquals(browsers.length, 1);
            assertEquals(contexts.length, 1);
            assertEquals(contexts[0].pages(), [page]);
            assertEquals(loginCookies.length, 1);
            assertEquals(homeCookies.at(-1), "session=v0");
            assertEquals(homeRequests.at(-1), "https://study.ns.kogakuin.ac.jp/lms/homeRedirect/?from=menu");
            const state = JSON.parse(await Deno.readTextFile(storagePath));
            assertEquals(state.cookies[0].value, "v1");
        });

        await t.step("failure discards the browser and the next refresh restores saved cookies", async () => {
            await assertRejects(() =>
                runtime.runPromise(Effect.gen(function* () {
                    const source = yield* LmsSourceGateway;
                    return yield* source.withSession("auto", () =>
                        Effect.fail(new LmsSourceGatewayError({ operation: "test", message: "failure" })));
                })), LmsSourceGatewayError);
            assertEquals(browsers[0].isConnected(), false);
            await runtime.runPromise(fetch);
            assertEquals(browsers.length, 2);
            assertEquals(loginCookies.at(-1), "session=v1");
        });

        await t.step("logout clears the retained context and its authentication", async () => {
            await runtime.runPromise(
                Effect.flatMap(LmsAuthenticationGateway, (authentication) => authentication.logout),
            );
            assertEquals(browsers.at(-1)!.isConnected(), false);
            await assertRejects(() => Deno.stat(storagePath), Deno.errors.NotFound);
            await runtime.runPromise(fetch);
            assertEquals(browsers.length, 3);
            assertEquals(loginCookies.at(-1), undefined);
        });

        await t.step("auto retries interactively and reuses the successful visible-mode browser", async () => {
            await runtime.runPromise(
                Effect.flatMap(LmsAuthenticationGateway, (authentication) => authentication.logout),
            );
            requiresInteraction = true;
            await runtime.runPromise(fetch);
            assertEquals(modes.slice(-2), [true, false]);
            assertEquals(browsers.at(-2)!.isConnected(), false);
            const count = browsers.length;
            await runtime.runPromise(fetch);
            assertEquals(browsers.length, count);
            requiresInteraction = false;
            await runtime.runPromise(Effect.gen(function* () {
                const source = yield* LmsSourceGateway;
                yield* source.withSession("false", (session) => session.fetchCourses);
            }));
            assertEquals(browsers.length, count + 1);
            assertEquals(browsers.at(-2)!.isConnected(), false);
            assertEquals(modes.at(-1), true);
        });

        await t.step("material retrieval leaves the course page and the next operation resumes from HOME", async () => {
            const context = contexts.at(-1)!;
            const page = context.pages()[0];
            const logins = loginCookies.length;
            await runtime.runPromise(Effect.gen(function* () {
                const source = yield* LmsSourceGateway;
                yield* source.withSession("auto", (session) => session.fetchCourseMaterials(LmsCourseId("KOG1")));
            }));
            assertEquals(new URL(page.url()).pathname, "/lms/homeHoml/doLinkKougi");
            version++;
            assertEquals((await runtime.runPromise(fetch))[0].name, `Course v${version}`);
            assertEquals(loginCookies.length, logins);
            assertEquals(contexts.at(-1), context);
            assertEquals(context.pages(), [page]);
        });

        await t.step("expired authentication returns to login without replacing a usable browser", async () => {
            for (
                const destination of [
                    "https://study.ns.kogakuin.ac.jp/lms",
                    "https://study.ns.kogakuin.ac.jp/lms/lginLgir/",
                    "https://slink.secioss.com/pub/prelogin.cgi",
                    homeUrl,
                ]
            ) {
                const logins = loginCookies.length;
                const browserCount = browsers.length;
                expiredDestination = destination;
                loginAtHome = destination === homeUrl;
                await runtime.runPromise(fetch);
                assert(loginCookies.length > logins);
                assertEquals(browsers.length, browserCount);
            }
        });

        await t.step("expired authentication can still retry with an interactive browser", async () => {
            const previous = browsers.at(-1)!;
            expiredDestination = "https://slink.secioss.com/pub/prelogin.cgi";
            requiresInteraction = true;
            await runtime.runPromise(fetch);
            assertEquals(previous.isConnected(), false);
            assertEquals(modes.at(-1), false);
            requiresInteraction = false;
        });

        await t.step("partial initialization failures close the new browser and allow recovery", async () => {
            await runtime.runPromise(
                Effect.flatMap(LmsAuthenticationGateway, (authentication) => authentication.logout),
            );
            failNextContext = true;
            await assertRejects(() => runtime.runPromise(fetch), LmsSourceGatewayError);
            assertEquals(browsers.at(-1)!.isConnected(), false);
            await runtime.runPromise(fetch);
            assert(browsers.at(-1)!.isConnected());
        });

        await t.step("runtime disposal closes an idle retained browser", async () => {
            await runtime.dispose();
            assert(browsers.every((browser) => !browser.isConnected()));
            runtime = ManagedRuntime.make(makeLmsGatewaysLayer(storagePath));
            await runtime.runPromise(fetch);
        });

        await t.step("runtime disposal interrupts an active operation and closes its browser", async () => {
            const started = Deferred.makeUnsafe<void>();
            const pending = runtime.runPromiseExit(Effect.gen(function* () {
                const source = yield* LmsSourceGateway;
                return yield* source.withSession(
                    "auto",
                    () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
                );
            }));
            await Effect.runPromise(Deferred.await(started));
            await runtime.dispose();
            assertEquals((await pending)._tag, "Failure");
            assert(browsers.every((browser) => !browser.isConnected()));
        });
    } finally {
        await runtime.dispose();
        chromium.launch = launch;
        for (const browser of browsers) await browser.close();
        await Deno.remove(directory, { recursive: true });
    }
});
