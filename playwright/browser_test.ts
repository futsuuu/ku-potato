import { assert, assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { Deferred, Effect, Fiber } from "effect";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { makeBrowserSessionPool } from "./browser.ts";
import { LmsSourceGatewayError } from "../core/out_port.ts";

Deno.test("browser sessions retain successful contexts and recover after failures or external closure", async (t) => {
    const pool = makeBrowserSessionPool();
    let browser: Browser;
    let context: BrowserContext;
    let page: Page;
    try {
        await t.step("successful operations reuse the browser, context, and cookies", async () => {
            await Effect.runPromise(pool.withSession(true, (current, fresh, currentPage) =>
                Effect.promise(async () => {
                    assertEquals(fresh, true);
                    context = current;
                    browser = current.browser()!;
                    page = currentPage;
                    await current.addCookies([{ name: "session", value: "retained", url: "https://example.test" }]);
                })));
            assert(browser.isConnected());
            await Effect.runPromise(
                pool.withSession(undefined, (current, fresh, currentPage) =>
                    Effect.promise(async () => {
                        assertEquals(fresh, false);
                        assertStrictEquals(current, context);
                        assertStrictEquals(current.browser(), browser);
                        assertStrictEquals(currentPage, page);
                        assertEquals((await current.cookies())[0].value, "retained");
                    })),
            );
        });

        await t.step("an externally closed page is replaced while retaining its browser and context", async () => {
            await page.close();
            await Effect.runPromise(pool.withSession(true, (current, fresh, currentPage) =>
                Effect.sync(() => {
                    assertEquals(fresh, false);
                    assertStrictEquals(current, context);
                    assertStrictEquals(current.browser(), browser);
                    assert(currentPage !== page);
                    assertEquals(currentPage.isClosed(), false);
                })));
        });

        await t.step("a failed operation closes its browser and the next one starts fresh", async () => {
            await assertRejects(() =>
                Effect.runPromise(
                    pool.withSession(true, () =>
                        Effect.fail(new LmsSourceGatewayError({ operation: "test", message: "failed" }))),
                )
            );
            assertEquals(browser.isConnected(), false);
            await Effect.runPromise(pool.withSession(true, (current, fresh) =>
                Effect.sync(() => {
                    assertEquals(fresh, true);
                    context = current;
                    browser = current.browser()!;
                })));
        });

        await t.step("externally closed contexts and browsers are replaced", async () => {
            await context.close();
            await Effect.runPromise(pool.withSession(true, (current, fresh) =>
                Effect.sync(() => {
                    assertEquals(fresh, true);
                    assertEquals(browser.isConnected(), false);
                    context = current;
                    browser = current.browser()!;
                })));
            await browser.close();
            await Effect.runPromise(pool.withSession(true, (current, fresh) =>
                Effect.sync(() => {
                    assertEquals(fresh, true);
                    context = current;
                    browser = current.browser()!;
                })));
        });

        await t.step("defects discard the retained browser", async () => {
            await assertRejects(() => Effect.runPromise(pool.withSession(true, () => Effect.die("defect"))));
            assertEquals(browser.isConnected(), false);
        });

        await t.step("interruption closes the active browser", async () => {
            await Effect.runPromise(Effect.gen(function* () {
                const started = yield* Deferred.make<void>();
                const fiber = yield* Effect.forkChild(pool.withSession(true, (current) =>
                    Effect.gen(function* () {
                        browser = current.browser()!;
                        yield* Deferred.succeed(started, undefined);
                        return yield* Effect.never;
                    })));
                yield* Deferred.await(started);
                yield* Fiber.interrupt(fiber);
                assertEquals(browser.isConnected(), false);
            }));
        });

        await t.step("concurrent operations use one context exclusively", async () => {
            await Effect.runPromise(Effect.gen(function* () {
                const started = yield* Deferred.make<void>();
                const release = yield* Deferred.make<void>();
                const first = yield* Effect.forkChild(pool.withSession(true, (current) =>
                    Effect.gen(function* () {
                        context = current;
                        browser = current.browser()!;
                        yield* Deferred.succeed(started, undefined);
                        yield* Deferred.await(release);
                    })));
                yield* Deferred.await(started);
                const second = yield* Effect.forkChild(pool.withSession(true, (current, fresh) =>
                    Effect.sync(() => {
                        assertEquals(fresh, false);
                        assertStrictEquals(current, context);
                    })));
                yield* Deferred.succeed(release, undefined);
                yield* Fiber.join(first);
                yield* Fiber.join(second);
            }));
        });

        await t.step("shutdown closes the retained browser and rejects subsequent use", async () => {
            await Effect.runPromise(pool.close);
            assertEquals(browser.isConnected(), false);
            await assertRejects(() => Effect.runPromise(pool.withSession(true, () => Effect.void)));
            await Effect.runPromise(pool.close);
        });
    } finally {
        await Effect.runPromise(pool.close);
    }
});

Deno.test("one-shot browser sessions close the browser even after success", async () => {
    const pool = makeBrowserSessionPool(false);
    let browser: Browser | undefined;
    await Effect.runPromise(pool.withSession(true, (context) =>
        Effect.sync(() => {
            browser = context.browser()!;
        })));
    assertEquals(browser?.isConnected(), false);
});
