/** Outbound adapter for KU-LMS, implemented with Playwright. */
import {
    type HeadPolicy,
    LmsAuthenticationGateway,
    LmsAuthenticationRequiredError,
    LmsAuthenticationStorageError,
    LmsCourseNotFoundError,
    LmsMaterialNotFoundError,
    LmsSourceGateway,
    LmsSourceGatewayError,
    type LmsSourceSession,
} from "ku-potato-core/out_port";
import {
    type Course,
    type CourseMaterials,
    type CourseMaterialsSnapshot,
    LmsCourseId,
    LmsMaterialId,
    type Material,
    type MaterialFolder,
    type MaterialResourcesSnapshot,
    type Resource,
} from "ku-potato-domain";
import { DateTime, Effect, Semaphore } from "effect";
import * as playwright from "playwright-core";

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

/** Playwright implementations with the default user-local authentication state. */
const liveGateways = makeLmsGateways();
export const LmsSourceGatewayLive = liveGateways.source;
export const LmsAuthenticationGatewayLive = liveGateways.authentication;

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
                    message: `教材を講義内で取得できません: ${lmsMaterialId}`,
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

function tryPromise<A>(operation: string, evaluate: () => PromiseLike<A>) {
    return Effect.tryPromise({
        try: evaluate,
        catch: (cause) => new LmsSourceGatewayError({ operation, message: errorMessage(cause) }),
    });
}

function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}

const readCourses = Effect.fn("PlaywrightBrowser.readCourses")(function* (
    page: playwright.Page,
): Effect.fn.Return<Course[], LmsSourceGatewayError> {
    const courseCards = page.locator(".lms-cardname");
    yield* tryPromise("wait for course index", () => page.locator(".lms-weekly-area").waitFor());

    const courses: Course[] = [];
    for (const courseCard of yield* tryPromise("find course cards", () => courseCards.all())) {
        const name = normalizeText((yield* tryPromise("read course name", () => courseCard.textContent())) ?? "");
        const courseLink = courseCard.locator("a");
        if ((yield* tryPromise("find course link", () => courseLink.count())) === 0) {
            courses.push({ name, availability: "unavailable" });
            continue;
        }
        const lmsCourseId = yield* parseLmsCourseId(
            yield* tryPromise("read course click handler", () => courseLink.getAttribute("onclick")),
        );
        courses.push({ lmsCourseId, name, availability: "available" });
    }
    return courses;
});

const readCourseMaterials = Effect.fn("PlaywrightBrowser.readCourseMaterials")(function* (
    page: playwright.Page,
    lmsCourseId: LmsCourseId,
): Effect.fn.Return<CourseMaterials, LmsSourceGatewayError | LmsCourseNotFoundError> {
    yield* openCourseMaterials(page, lmsCourseId);
    const noFoldersMessage = page.getByText("授業が登録されていません。", { exact: true });
    if (yield* tryPromise("check course-material availability", () => noFoldersMessage.isVisible())) {
        return { lmsCourseId, folders: [] };
    }

    const folders: MaterialFolder[] = [];
    for (
        const folderRow of yield* tryPromise("find material folders", () => page.locator("tr.accordionHeader").all())
    ) {
        const folder = yield* readMaterialFolderInfo(folderRow);
        const contentRow = folderRow.locator("xpath=following-sibling::tr[1]");
        const materials: Material[] = [];
        for (
            const materialCell of yield* tryPromise(
                "find materials",
                () => contentRow.locator("td.kyozaititleCell").all(),
            )
        ) {
            materials.push(yield* readCourseMaterial(materialCell));
        }
        folders.push({ ...folder, materials });
    }
    return { lmsCourseId, folders };
});

const readMaterialResourcesFromCoursePage = Effect.fn("PlaywrightBrowser.readMaterialResourcesFromCoursePage")(
    function* (
        page: playwright.Page,
        lmsMaterialId: LmsMaterialId,
    ): Effect.fn.Return<Resource[], LmsSourceGatewayError> {
        const materialCell = page.locator(`td.kyozaititleCell#${lmsMaterialId}`);
        if ((yield* tryPromise("find material", () => materialCell.count())) === 0) {
            return yield* new LmsSourceGatewayError({
                operation: "find material",
                message: `教材を講義内で取得できません: ${lmsMaterialId}`,
            });
        }
        const materialLink = materialCell.locator("a");
        if ((yield* tryPromise("find material resource link", () => materialLink.count())) === 0) {
            return yield* new LmsSourceGatewayError({
                operation: "find material resource link",
                message: `教材の資料は未公開です: ${lmsMaterialId}`,
            });
        }
        yield* tryPromise(
            "open material resources",
            () => materialLink.evaluate((element) => (element as { click(): void }).click()),
        );
        yield* tryPromise(
            "wait for material resources",
            () => page.getByRole("columnheader", { name: "資料名", exact: true }).waitFor(),
        );
        return (yield* tryPromise(
            "read resource names",
            () => page.locator('td[data-label="資料名"]').allTextContents(),
        ))
            .map(normalizeText)
            .map((name): Resource => ({ name }));
    },
);

const openCourseMaterials = Effect.fn("PlaywrightBrowser.openCourseMaterials")(function* (
    page: playwright.Page,
    lmsCourseId: LmsCourseId,
): Effect.fn.Return<void, LmsSourceGatewayError | LmsCourseNotFoundError> {
    yield* tryPromise("wait for course index", () => page.locator(".lms-weekly-area").waitFor());
    let courseLink: playwright.Locator | undefined;
    for (const candidate of yield* tryPromise("find course links", () => page.locator(".lms-cardname a").all())) {
        const candidateId = yield* parseLmsCourseId(
            yield* tryPromise("read course click handler", () => candidate.getAttribute("onclick")),
        );
        if (candidateId === lmsCourseId) {
            courseLink = candidate;
            break;
        }
    }
    if (courseLink === undefined) {
        return yield* new LmsCourseNotFoundError({
            lmsCourseId,
            message: `講義をHOMEで取得できません: ${lmsCourseId}`,
        });
    }
    yield* tryPromise("open course", () => courseLink.click());
    const noFoldersMessage = page.getByText("授業が登録されていません。", { exact: true });
    yield* tryPromise(
        "wait for course materials",
        () => page.locator(".courseFolderName").or(noFoldersMessage).first().waitFor(),
    );
});

const openLmsHome = Effect.fn("PlaywrightBrowser.openLmsHome")(function* (
    page: playwright.Page,
): Effect.fn.Return<void, LmsSourceGatewayError> {
    const courseIndex = page.locator(".lms-weekly-area");
    if (yield* tryPromise("check course index", () => courseIndex.isVisible())) return;

    const homeLink = page.locator("a[href*='/lms/homeRedirect/']").first();
    const homeHref = yield* tryPromise("find KU-LMS home link", () => homeLink.getAttribute("href"));
    if (homeHref === null) {
        return yield* new LmsSourceGatewayError({
            operation: "open KU-LMS home",
            message: "認証済み画面からKU-LMSホームへのリンクを取得できません。",
        });
    }
    yield* tryPromise("open KU-LMS home", () => page.goto(new URL(homeHref, page.url()).href));
    yield* tryPromise("wait for course index", () => courseIndex.waitFor());
});

const readMaterialFolderInfo = Effect.fn("PlaywrightBrowser.readMaterialFolderInfo")(function* (
    folderRow: playwright.Locator,
): Effect.fn.Return<Omit<MaterialFolder, "materials">, LmsSourceGatewayError> {
    const name = normalizeText(
        (yield* tryPromise("read material folder name", () => folderRow.locator(".courseFolderName").textContent())) ??
            "",
    );
    const classDate = yield* parseLmsDate(yield* readOptionalText(folderRow.locator("td.checkStBoldJyugyoDy")));
    return { name, ...(classDate === undefined ? {} : { classDate }) };
});

const readCourseMaterial = Effect.fn("PlaywrightBrowser.readCourseMaterial")(function* (
    materialCell: playwright.Locator,
): Effect.fn.Return<Material, LmsSourceGatewayError> {
    const lmsMaterialId = yield* parseLmsMaterialId(
        yield* tryPromise("read LMS material ID", () => materialCell.getAttribute("id")),
    );
    const name = normalizeText(
        (yield* tryPromise("read material name", () => materialCell.textContent())) ?? "",
    );
    const type = yield* parseMaterialType(
        yield* tryPromise("read material type", () => materialCell.locator("i[title]").first().getAttribute("title")),
    );
    const publicationDeadline = yield* parsePublicationDeadline(
        yield* readOptionalText(materialCell.locator("xpath=following-sibling::td[1]")),
    );
    if (type !== "material") return { lmsMaterialId, name, type, publicationDeadline };
    const resourceAvailability = (yield* tryPromise("find material resource link", () =>
            materialCell.locator("a").count())) > 0
        ? "available"
        : "unavailable";
    return { lmsMaterialId, name, type, publicationDeadline, resourceAvailability };
});

const loginToLms = Effect.fn("PlaywrightBrowser.loginToLms")(function* (
    page: playwright.Page,
    allowInteraction: boolean,
): Effect.fn.Return<void, LmsSourceGatewayError | LmsAuthenticationRequiredError> {
    yield* tryPromise("open KU-LMS", () => page.goto("https://study.ns.kogakuin.ac.jp/lms"));
    yield* tryPromise("click KU-LMS login", () => page.locator("button[name='loginButton']").click());
    if (isLmsAuthenticatedUrl(page.url())) return;
    if (!allowInteraction) {
        return yield* new LmsAuthenticationRequiredError({
            message: "KU-LMSへのログインにはユーザー操作が必要です。",
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
        yield* tryPromise("return to KU-LMS", () => page.goto("https://study.ns.kogakuin.ac.jp/lms"));
        yield* tryPromise("click KU-LMS login", () => page.locator("button[name='loginButton']").click());
    }
    yield* tryPromise("wait for KU-LMS login", () =>
        page.waitForURL(
            (url) => isLmsAuthenticatedUrl(url),
            { timeout: 10 * 60 * 1000 },
        ));
});

const isLmsAuthenticatedUrl = (url: string | URL): boolean => {
    const parsed = typeof url === "string" ? new URL(url) : url;
    return parsed.hostname === "study.ns.kogakuin.ac.jp" && parsed.pathname.startsWith("/lms/");
};

export function parseMaterialType(title: string | null): Effect.Effect<Material["type"], LmsSourceGatewayError> {
    switch (title) {
        case "Materials":
        case "資料":
            return Effect.succeed("material");
        case "e-Learning":
        case "e-learning":
            return Effect.succeed("e-learning");
        case "Report":
        case "レポート":
            return Effect.succeed("report");
        case "Test":
        case "テスト":
            return Effect.succeed("test");
        case "Questionnaire":
        case "アンケート":
            return Effect.succeed("questionnaire");
        default:
            return Effect.fail(
                new LmsSourceGatewayError({
                    operation: "parse material type",
                    message: `未対応の教材の種類: ${title}`,
                }),
            );
    }
}

/** Extracts the LMS course ID passed to the HOME page's course-opening form. */
export function parseLmsCourseId(onclick: string | null): Effect.Effect<LmsCourseId, LmsSourceGatewayError> {
    const match = onclick?.match(/\bformSubmit\(\s*["']([^"']+)["']/);
    if (match?.[1] !== undefined) return Effect.succeed(LmsCourseId(match[1]));
    return Effect.fail(
        new LmsSourceGatewayError({
            operation: "parse LMS course ID",
            message: `講義のクリックハンドラーからLMS講義IDを取得できません: ${onclick}`,
        }),
    );
}

/** Extracts the LMS material ID assigned to a material cell. */
export function parseLmsMaterialId(value: string | null): Effect.Effect<LmsMaterialId, LmsSourceGatewayError> {
    if (value !== null && /^[A-Z]+\d+$/.test(value)) return Effect.succeed(LmsMaterialId(value));
    return Effect.fail(
        new LmsSourceGatewayError({
            operation: "parse LMS material ID",
            message: `教材セルからLMS教材IDを取得できません: ${value}`,
        }),
    );
}

export function parsePublicationDeadline(
    text: string | undefined,
): Effect.Effect<Material["publicationDeadline"], LmsSourceGatewayError> {
    if (text === "公開終了" || text === "Unavailable") return Effect.succeed("unavailable");
    return parseLmsDate(text).pipe(Effect.map((date) => date ?? "no-deadline"));
}

/** Parses an LMS date as Japan Standard Time. A date-only value means midnight JST. */
export function parseLmsDate(text: string | undefined): Effect.Effect<Date | undefined, LmsSourceGatewayError> {
    if (text === undefined) return Effect.succeed(undefined satisfies Date | undefined);
    const iso = text.replaceAll("/", "-").replace(" ", "T");
    return Effect.try({
        try: () => DateTime.toDate(DateTime.makeUnsafe(`${iso.includes("T") ? iso : `${iso}T00:00:00`}+09:00`)),
        catch: (cause) => new LmsSourceGatewayError({ operation: "parse LMS date", message: errorMessage(cause) }),
    });
}

const readOptionalText = Effect.fn("PlaywrightBrowser.readOptionalText")(function* (
    locator: playwright.Locator,
): Effect.fn.Return<string | undefined, LmsSourceGatewayError> {
    const text = normalizeText((yield* tryPromise("read optional text", () => locator.textContent())) ?? "");
    return text === "" || /^[-‐‑‒–—―－]+$/.test(text) ? undefined : text;
});

function normalizeText(text: string) {
    return text.replace(/\s+/g, " ").trim();
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
