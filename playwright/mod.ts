/** Outbound adapter for KU-LMS, implemented with Playwright. */
import {
    type HeadPolicy,
    LmsAuthenticationGateway,
    LmsAuthenticationStorageError,
    LmsMaterialNotFoundError,
    LmsSourceGateway,
    type LmsSourceSession,
} from "../core/out_port.ts";
import { type CourseMaterialsSnapshot, type MaterialResourcesSnapshot } from "../domain/mod.ts";
import { Effect, Semaphore } from "effect";
import * as playwright from "playwright-core";
import { openLmsHome, readCourses } from "./home.ts";
import { readCourseMaterials } from "./course.ts";
import { readMaterialResourcesFromCoursePage } from "./resources.ts";
import { loginToLms } from "./login.ts";
import { errorMessage, tryPromise } from "./promise.ts";

export { parseLmsCourseId } from "./home.ts";
export { parseLmsDate, parseLmsMaterialId, parseMaterialType, parsePublicationDeadline } from "./parsing.ts";

/** The default user-local location for Playwright authentication state. */
export const defaultAuthenticationStoragePath = (): string => {
    const localAppData = Deno.env.get("LOCALAPPDATA");
    return localAppData === undefined
        ? `${Deno.cwd()}/.ku-potato/auth/storage-state.json`
        : `${localAppData}/ku-potato/auth/storage-state.json`;
};

/** Creates an LMS source that opens one exclusive tab per operation. */
export const makeLmsSourceGateway = (storageStatePath = defaultAuthenticationStoragePath()) =>
    makeLmsGateways(storageStatePath).source;

/** Creates authentication operations backed by the same local browser state. */
export const makeLmsAuthenticationGateway = (storageStatePath = defaultAuthenticationStoragePath()) =>
    makeLmsGateways(storageStatePath).authentication;

/** Creates source and authentication gateways that share one process-local browser permit. */
export const makeLmsGateways = (storageStatePath = defaultAuthenticationStoragePath()) => {
    const browserPermit = Semaphore.makeUnsafe(1);
    const exclusively = browserPermit.withPermits(1);
    return {
        source: LmsSourceGateway.of({
            withSession: (headPolicy, use) => exclusively(withAuthenticatedSession(storageStatePath, headPolicy, use)),
        }),
        authentication: LmsAuthenticationGateway.of({
            login: (headPolicy) =>
                exclusively(withAuthenticatedSession(storageStatePath, headPolicy, () => Effect.void)),
            logout: exclusively(removeAuthenticationState(storageStatePath)),
            status: exclusively(withBrowserSession(storageStatePath, true, false, () => Effect.void)).pipe(
                Effect.as("authenticated" as const),
                Effect.catchTag("LmsAuthenticationRequiredError", () => Effect.succeed("unauthenticated" as const)),
            ),
        }),
    };
};

function withAuthenticatedSession<A, E, R>(
    storageStatePath: string,
    headPolicy: HeadPolicy,
    use: (session: LmsSourceSession) => Effect.Effect<A, E, R>,
) {
    switch (headPolicy) {
        case "true":
            return withBrowserSession(storageStatePath, false, true, use);
        case "false":
            return withBrowserSession(storageStatePath, true, false, use);
        case "auto":
            return withBrowserSession(storageStatePath, true, false, use).pipe(
                Effect.catchTag(
                    "LmsAuthenticationRequiredError",
                    () => withBrowserSession(storageStatePath, false, true, use),
                ),
            );
    }
}

function withBrowserSession<A, E, R>(
    storageStatePath: string,
    headless: boolean,
    allowInteraction: boolean,
    use: (session: LmsSourceSession) => Effect.Effect<A, E, R>,
) {
    return Effect.scoped(Effect.gen(function* () {
        const browser = yield* Effect.acquireRelease(
            tryPromise("launch browser", () => launchBrowser({ headless })),
            (browser) => tryPromise("close browser", () => browser.close()).pipe(Effect.catch(Effect.logError)),
        );
        const context = yield* Effect.acquireRelease(
            tryPromise("create browser context", () => browser.newContext()),
            (context) => tryPromise("close browser context", () => context.close()).pipe(Effect.catch(Effect.logError)),
        );
        yield* restoreAuthenticationState(context, storageStatePath);
        const page = yield* tryPromise("create browser page", () => context.newPage());
        yield* loginToLms(page, allowInteraction);
        yield* saveAuthenticationState(context, storageStatePath);
        return yield* use(makeSession(page));
    }));
}

const makeSession = (page: playwright.Page): LmsSourceSession => {
    const semaphore = Semaphore.makeUnsafe(1);
    return {
        fetchCourses: semaphore.withPermits(1)(
            openLmsHome(page).pipe(Effect.andThen(readCourses(page))),
        ),
        fetchCourseMaterials: (lmsCourseId) =>
            semaphore.withPermits(1)(Effect.gen(function* () {
                yield* openLmsHome(page);
                const courses = yield* readCourses(page);
                const courseMaterials = yield* readCourseMaterials(page, lmsCourseId);
                return { courses, courseMaterials } satisfies CourseMaterialsSnapshot;
            })),
        fetchMaterialResources: (lmsMaterialId) =>
            semaphore.withPermits(1)(Effect.gen(function* () {
                yield* openLmsHome(page);
                const courses = yield* readCourses(page);
                for (const course of courses) {
                    if (course.availability === "unavailable") continue;
                    yield* openLmsHome(page);
                    const courseMaterials = yield* readCourseMaterials(page, course.lmsCourseId).pipe(
                        Effect.catchTag("LmsCourseNotFoundError", () => Effect.void),
                    );
                    if (courseMaterials === undefined) continue;
                    const material = courseMaterials.folders
                        .flatMap((folder) => folder.materials)
                        .find((material) => material.lmsMaterialId === lmsMaterialId);
                    if (material === undefined) continue;
                    const resources = material.type === "material" && material.resourceAvailability === "available"
                        ? yield* readMaterialResourcesFromCoursePage(page, lmsMaterialId)
                        : [];
                    return {
                        courses,
                        courseMaterials,
                        materialResources: { lmsMaterialId, resources },
                    } satisfies MaterialResourcesSnapshot;
                }
                return yield* new LmsMaterialNotFoundError({
                    lmsMaterialId,
                    message: `Cannot find the material in any available course: ${lmsMaterialId}`,
                });
            })),
    };
};

const restoreAuthenticationState = Effect.fn("PlaywrightBrowser.restoreAuthenticationState")(function* (
    context: playwright.BrowserContext,
    storageStatePath: string,
) {
    const exists = yield* authenticationStorageTry("read authentication state", () =>
        Deno.stat(storageStatePath).then(
            () => true,
            (cause) => cause instanceof Deno.errors.NotFound ? false : Promise.reject(cause),
        ));
    if (exists) {
        yield* authenticationStorageTry(
            "restore authentication state",
            () => context.setStorageState(storageStatePath),
        );
    }
});

const saveAuthenticationState = Effect.fn("PlaywrightBrowser.saveAuthenticationState")(function* (
    context: playwright.BrowserContext,
    storageStatePath: string,
) {
    yield* authenticationStorageTry(
        "create authentication state directory",
        () => Deno.mkdir(parentDirectory(storageStatePath), { recursive: true }),
    );
    yield* authenticationStorageTry(
        "save authentication state",
        () => context.storageState({ path: storageStatePath }),
    );
});

function removeAuthenticationState(storageStatePath: string) {
    return authenticationStorageTry(
        "remove authentication state",
        () =>
            Deno.remove(storageStatePath).catch((cause) =>
                cause instanceof Deno.errors.NotFound ? undefined : Promise.reject(cause)
            ),
    );
}

function authenticationStorageTry<A>(operation: string, evaluate: () => PromiseLike<A>) {
    return Effect.tryPromise({
        try: evaluate,
        catch: (cause) => new LmsAuthenticationStorageError({ operation, message: errorMessage(cause) }),
    });
}

function launchBrowser(opts: { headless: boolean }) {
    return playwright.chromium.launch({
        channel: "chrome",
        headless: opts.headless,
        args: ["--disable-blink-features=AutomationControlled"],
    });
}

const parentDirectory = (path: string): string => {
    const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    if (separatorIndex === -1) return ".";
    return separatorIndex === 2 && path[1] === ":" ? path.slice(0, separatorIndex + 1) : path.slice(0, separatorIndex);
};
