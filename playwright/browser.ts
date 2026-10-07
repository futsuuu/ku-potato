import { Effect, Exit, Scope, Semaphore } from "effect";
import * as playwright from "playwright-core";
import { tryPromise } from "./promise.ts";

interface BrowserSession {
    readonly browser: playwright.Browser;
    readonly context: playwright.BrowserContext;
    readonly headless: boolean;
    readonly scope: Scope.Closeable;
    page: playwright.Page;
    contextClosed: boolean;
}

/** Retains a successful browser, context, and page until reset or disposal. */
export function makeBrowserSessionPool(reuse = true) {
    const permit = Semaphore.makeUnsafe(1);
    let retained: BrowserSession | undefined;
    let disposed = false;

    const reset = Effect.fnUntraced(function* () {
        const previous = retained;
        retained = undefined;
        if (previous) yield* Scope.close(previous.scope, Exit.void);
    });

    const withSession = <A, E, R>(
        headless: boolean | undefined,
        use: (context: playwright.BrowserContext, fresh: boolean, page: playwright.Page) => Effect.Effect<A, E, R>,
    ) => permit.withPermits(1)(Effect.scoped(Effect.gen(function* () {
        if (disposed) return yield* Effect.die("Browser session pool has been disposed.");
        yield* Effect.addFinalizer((exit) => !reuse || Exit.isFailure(exit) ? reset() : Effect.void);
        if (
            retained && (!retained.browser.isConnected() || retained.contextClosed ||
                (headless !== undefined && retained.headless !== headless))
        ) yield* reset();
        const fresh = retained === undefined;
        if (!retained) {
            const scope = yield* Effect.acquireRelease(
                Scope.make(),
                (scope, exit) => retained?.scope === scope ? Effect.void : Scope.close(scope, exit),
            );
            retained = yield* Effect.gen(function* () {
                const mode = headless ?? true;
                const browser = yield* Effect.acquireRelease(
                    tryPromise("launch browser", () =>
                        playwright.chromium.launch({
                            channel: "chrome",
                            headless: mode,
                            args: ["--disable-blink-features=AutomationControlled"],
                        })),
                    (browser) => tryPromise("close browser", () => browser.close()).pipe(Effect.catch(Effect.logError)),
                );
                const context = yield* Effect.acquireRelease(
                    tryPromise("create browser context", () => browser.newContext({ acceptDownloads: true })),
                    (context) =>
                        tryPromise("close browser context", () => context.close()).pipe(Effect.catch(Effect.logError)),
                );
                const page = yield* tryPromise("create browser page", () => context.newPage());
                const session: BrowserSession = { browser, context, page, headless: mode, scope, contextClosed: false };
                context.once("close", () => {
                    session.contextClosed = true;
                });
                return session;
            }).pipe(Effect.provideService(Scope.Scope, scope));
        }
        if (retained.page.isClosed()) {
            retained.page = yield* tryPromise("create browser page", () => retained!.context.newPage());
        }
        return yield* use(retained.context, fresh, retained.page);
    })));

    return {
        withSession,
        reset: permit.withPermits(1)(reset()),
        close: permit.withPermits(1)(Effect.gen(function* () {
            disposed = true;
            yield* reset();
        })),
    };
}

export type BrowserSessionPool = ReturnType<typeof makeBrowserSessionPool>;
