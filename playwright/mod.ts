/** Outbound adapter for KU-LMS, implemented with Playwright. */
import { LmsSourceGateway, LmsSourceGatewayError } from "ku-potato-core/out_port";
import {
    type Course,
    type CourseMaterial,
    type CourseMaterialFolder,
    type CourseMaterials,
    type CourseMaterialsRefresh,
    LmsCourseId,
    LmsMaterialId,
    type MaterialFolderInfo,
    type MaterialResource,
    type MaterialResourcesRefresh,
} from "ku-potato-domain";
import { DateTime, Effect } from "effect";
import * as playwright from "playwright-core";

function withLoggedInLms<A>(
    operation: (page: playwright.Page) => Effect.Effect<A, LmsSourceGatewayError>,
): Effect.Effect<A, LmsSourceGatewayError> {
    return Effect.scoped(Effect.gen(function* () {
        const browser = yield* Effect.acquireRelease(
            tryPromise("launch browser", () => launchBrowser({ headless: false })),
            (browser) => tryPromise("close browser", () => browser.close()).pipe(Effect.catch(Effect.logError)),
        );
        const context = yield* Effect.acquireRelease(
            tryPromise("create browser context", () => browser.newContext()),
            (context) => tryPromise("close browser context", () => context.close()).pipe(Effect.catch(Effect.logError)),
        );
        yield* Effect.acquireRelease(
            tryPromise(
                "restore browser storage state",
                () => context.setStorageState(".storage-state.json").catch(() => undefined),
            ),
            () =>
                tryPromise(
                    "save browser storage state",
                    () =>
                        context.storageState().then(JSON.stringify).then((state) =>
                            Deno.writeTextFile(".storage-state.json", state)
                        ),
                ).pipe(Effect.catch(Effect.logError)),
        );
        const page = yield* tryPromise("create browser page", () => context.newPage());
        yield* loginToLms(page);
        return yield* operation(page);
    }));
}

/** Playwright implementation of the external LMS source port. */
export const LmsSourceGatewayLive = LmsSourceGateway.of({
    refreshCourses: Effect.suspend(() => withLoggedInLms(readCourses)),
    refreshCourseMaterials: (lmsCourseId) =>
        withLoggedInLms((page) =>
            Effect.gen(function* () {
                const courses = yield* readCourses(page);
                const courseMaterials = yield* readCourseMaterials(page, lmsCourseId);
                return { courses, courseMaterials } satisfies CourseMaterialsRefresh;
            })
        ),
    refreshMaterialResources: (lmsCourseId, lmsMaterialId) =>
        withLoggedInLms((page) =>
            Effect.gen(function* () {
                const courses = yield* readCourses(page);
                const courseMaterials = yield* readCourseMaterials(page, lmsCourseId);
                const resources = yield* readMaterialResourcesFromCoursePage(page, lmsMaterialId);
                return {
                    courses,
                    courseMaterials,
                    materialResources: { lmsCourseId, lmsMaterialId, resources },
                } satisfies MaterialResourcesRefresh;
            })
        ),
});

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
    yield* captureCourseIndexDebugArtifacts(page, courseCards);

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
): Effect.fn.Return<CourseMaterials, LmsSourceGatewayError> {
    yield* openCourseMaterials(page, lmsCourseId);
    const noFoldersMessage = page.getByText("授業が登録されていません。", { exact: true });
    if (yield* tryPromise("check course-material availability", () => noFoldersMessage.isVisible())) {
        return { lmsCourseId, folders: [] };
    }

    const folders: CourseMaterialFolder[] = [];
    for (
        const folderRow of yield* tryPromise("find material folders", () => page.locator("tr.accordionHeader").all())
    ) {
        const folder = yield* readMaterialFolderInfo(folderRow);
        const contentRow = folderRow.locator("xpath=following-sibling::tr[1]");
        const materials: CourseMaterial[] = [];
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
    ): Effect.fn.Return<MaterialResource[], LmsSourceGatewayError> {
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
            .map((name): MaterialResource => ({ name }));
    },
);

const openCourseMaterials = Effect.fn("PlaywrightBrowser.openCourseMaterials")(function* (
    page: playwright.Page,
    lmsCourseId: LmsCourseId,
): Effect.fn.Return<void, LmsSourceGatewayError> {
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
        return yield* new LmsSourceGatewayError({
            operation: "find course",
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

const readMaterialFolderInfo = Effect.fn("PlaywrightBrowser.readMaterialFolderInfo")(function* (
    folderRow: playwright.Locator,
): Effect.fn.Return<MaterialFolderInfo, LmsSourceGatewayError> {
    const name = normalizeText(
        (yield* tryPromise("read material folder name", () => folderRow.locator(".courseFolderName").textContent())) ??
            "",
    );
    const classDate = yield* parseLmsDate(yield* readOptionalText(folderRow.locator("td.checkStBoldJyugyoDy")));
    return { name, ...(classDate === undefined ? {} : { classDate }) };
});

const readCourseMaterial = Effect.fn("PlaywrightBrowser.readCourseMaterial")(function* (
    materialCell: playwright.Locator,
): Effect.fn.Return<CourseMaterial, LmsSourceGatewayError> {
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
): Effect.fn.Return<void, LmsSourceGatewayError> {
    yield* tryPromise("open KU-LMS", () => page.goto("https://study.ns.kogakuin.ac.jp/lms"));
    yield* tryPromise("click KU-LMS login", () => page.locator("button[name='loginButton']").click());
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
        return;
    }
    yield* tryPromise("wait for KU-LMS login", () =>
        page.waitForURL(
            (url) => url.hostname === "study.ns.kogakuin.ac.jp" && url.pathname.startsWith("/lms/"),
            { timeout: 10 * 60 * 1000 },
        ));
});

const captureCourseIndexDebugArtifacts = Effect.fn("PlaywrightBrowser.captureCourseIndexDebugArtifacts")(
    function* (
        page: playwright.Page,
        courseCards: playwright.Locator,
    ): Effect.fn.Return<void, LmsSourceGatewayError> {
        const timestamp = DateTime.formatIso(DateTime.nowUnsafe()).replace(/[:.]/g, "-");
        const directory = `.debug/list-courses/${timestamp}`;
        yield* tryPromise("create course-index debug directory", () => Deno.mkdir(directory, { recursive: true }));
        const [html, aria, cardHtml] = yield* Effect.all([
            tryPromise("capture course-index HTML", () => page.content()),
            tryPromise("capture course-index accessibility tree", () => page.ariaSnapshot({ boxes: true, mode: "ai" })),
            tryPromise(
                "capture course-card HTML",
                () => courseCards.evaluateAll((cards) => cards.map((card) => card.outerHTML).join("\n\n")),
            ),
        ]);
        yield* Effect.all([
            tryPromise("write course-index HTML", () => Deno.writeTextFile(`${directory}/home.html`, html)),
            tryPromise("write course-card HTML", () => Deno.writeTextFile(`${directory}/course-cards.html`, cardHtml)),
            tryPromise(
                "write course-index accessibility tree",
                () => Deno.writeTextFile(`${directory}/home.aria.yml`, aria),
            ),
            tryPromise(
                "take course-index screenshot",
                () => page.screenshot({ path: `${directory}/home.png`, fullPage: true }),
            ),
        ]);
        yield* Effect.logInfo(`講義一覧のデバッグ情報を保存しました: ${directory}`);
    },
);

export function parseMaterialType(title: string | null): Effect.Effect<CourseMaterial["type"], LmsSourceGatewayError> {
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
): Effect.Effect<CourseMaterial["publicationDeadline"], LmsSourceGatewayError> {
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
