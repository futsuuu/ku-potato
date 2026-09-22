/** Outbound adapter for KU-LMS, implemented with Playwright. */
import { type CourseMaterialsGateway, CourseMaterialsGatewayError } from "ku-potato-core/out_port";
import type { AvailableCourseMaterials, CourseMaterials, Material, MaterialFolder } from "ku-potato-domain";
import { DateTime, Effect } from "effect";
import * as playwright from "playwright-core";

const listCourseMaterialsFromLms = Effect.scoped(Effect.gen(function* () {
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

    const courseNames = (yield* tryPromise("read course names", () => page.locator(".lms-cardname").allTextContents()))
        .map(normalizeText);
    return yield* Effect.forEach(
        courseNames,
        (courseName) =>
            getCourseMaterials(page, courseName).pipe(
                Effect.map((course): CourseMaterials =>
                    course === null
                        ? { name: courseName, availability: "unavailable" }
                        : { name: courseName, availability: "available", ...course }
                ),
            ),
        { concurrency: 1 },
    );
}));

export const CourseMaterialsGatewayLive: CourseMaterialsGateway = {
    list: listCourseMaterialsFromLms,
};

function tryPromise<A>(operation: string, evaluate: () => PromiseLike<A>) {
    return Effect.tryPromise({
        try: evaluate,
        catch: (cause) => new CourseMaterialsGatewayError({ operation, message: errorMessage(cause) }),
    });
}

function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}

const loginToLms = Effect.fn("PlaywrightBrowser.loginToLms")(function* (
    page: playwright.Page,
): Effect.fn.Return<void, CourseMaterialsGatewayError> {
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

/** Gets one course then returns the page to HOME. `null` means it is unavailable. */
const getCourseMaterials = Effect.fn("PlaywrightBrowser.getCourseMaterials")(
    function* (
        page: playwright.Page,
        courseName: string,
    ): Effect.fn.Return<Omit<AvailableCourseMaterials, "name" | "availability"> | null, CourseMaterialsGatewayError> {
        const courseCard = page.getByText(courseName, { exact: true });
        yield* tryPromise("find course card", () => courseCard.waitFor());
        const courseLink = courseCard.locator("a");
        if ((yield* tryPromise("find course link", () => courseLink.count())) === 0) return null;
        yield* tryPromise("open course", () => courseLink.click());

        const noFoldersMessage = page.getByText("授業が登録されていません。", { exact: true });
        yield* tryPromise(
            "wait for course materials",
            () => page.locator(".courseFolderName").or(noFoldersMessage).first().waitFor(),
        );
        const overview = yield* getCourseOverview(page);
        const folders = yield* getMaterialFolders(page);
        if (
            folders.length === 0 &&
            !(yield* tryPromise("check course-material availability", () => noFoldersMessage.isVisible()))
        ) {
            return yield* new CourseMaterialsGatewayError({
                operation: "read course materials",
                message: `教材フォルダーを取得できません: ${courseName}`,
            });
        }
        yield* tryPromise(
            "return to course home",
            () => page.locator(".lms-breadcrumb a", { hasText: "HOME" }).click(),
        );
        yield* tryPromise("wait for course home", () => page.locator(".lms-weekly-area").waitFor());
        return {
            courseCode: overview?.courseCode ?? null,
            year: overview?.year ?? inferCourseYear(folders),
            folders,
        } satisfies Omit<AvailableCourseMaterials, "name" | "availability">;
    },
);

const getCourseOverview = Effect.fn("PlaywrightBrowser.getCourseOverview")(function* (
    page: playwright.Page,
): Effect.fn.Return<Pick<AvailableCourseMaterials, "courseCode" | "year"> | null, CourseMaterialsGatewayError> {
    const overviewLink = page.getByRole("link", { name: "講義概要", exact: true });
    if ((yield* tryPromise("find course overview", () => overviewLink.count())) === 0) return null;
    yield* tryPromise("open course overview", () => overviewLink.click());
    const table = page.locator("table.lms-form-table");
    const courseCode = normalizeText(
        yield* tryPromise("read course code", () =>
            table.locator("tr").filter({
                has: page.locator("th").filter({ hasText: /^講義コード$/ }),
            }).locator("td").innerText()),
    );
    const yearText = normalizeText(
        yield* tryPromise("read course year", () =>
            table.locator("tr").filter({
                has: page.locator("th").filter({ hasText: /^年度$/ }),
            }).locator("td").innerText()),
    );
    if (courseCode === "") {
        return yield* new CourseMaterialsGatewayError({
            operation: "read course code",
            message: "講義コードが空です",
        });
    }
    if (!/^\d{4}$/.test(yearText)) {
        return yield* new CourseMaterialsGatewayError({
            operation: "read course year",
            message: `年度を取得できません: ${yearText}`,
        });
    }
    yield* tryPromise("return to course materials", () => page.locator(".lms-breadcrumb a").nth(1).click());
    yield* tryPromise(
        "wait for course materials",
        () =>
            page.locator(".courseFolderName").or(page.getByText("授業が登録されていません。", {
                exact: true,
            })).first().waitFor(),
    );
    return { courseCode, year: Number(yearText) } satisfies Pick<AvailableCourseMaterials, "courseCode" | "year">;
});

function inferCourseYear(folders: readonly MaterialFolder[]): number | null {
    const years = new Set(folders.flatMap((folder) => {
        if (folder.classDate === undefined) return [];
        return [
            Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Tokyo" }).format(folder.classDate)),
        ];
    }));
    return years.size === 1 ? [...years][0] : null;
}

const getMaterialFolders = Effect.fn("PlaywrightBrowser.getMaterialFolders")(function* (
    page: playwright.Page,
): Effect.fn.Return<MaterialFolder[], CourseMaterialsGatewayError> {
    const folders: MaterialFolder[] = [];
    for (
        const folderRow of yield* tryPromise("find material folders", () => page.locator("tr.accordionHeader").all())
    ) {
        const name = normalizeText(
            (yield* tryPromise(
                "read material folder name",
                () => folderRow.locator(".courseFolderName").textContent(),
            )) ?? "",
        );
        const classDate = yield* parseLmsDate(yield* readOptionalText(folderRow.locator("td.checkStBoldJyugyoDy")));
        const contentRow = folderRow.locator("xpath=following-sibling::tr[1]");
        const materials = yield* getMaterials(page, contentRow);
        folders.push({ name, ...(classDate === undefined ? {} : { classDate }), materials });
    }
    return folders;
});

const getMaterials = Effect.fn("PlaywrightBrowser.getMaterials")(
    function* (
        page: playwright.Page,
        contentRow: playwright.Locator,
    ): Effect.fn.Return<Material[], CourseMaterialsGatewayError> {
        const materials: Material[] = [];
        for (
            const materialCell of yield* tryPromise(
                "find materials",
                () => contentRow.locator("td.kyozaititleCell").all(),
            )
        ) {
            const name = normalizeText(
                (yield* tryPromise("read material name", () => materialCell.textContent())) ?? "",
            );
            const type = yield* parseMaterialType(
                yield* tryPromise(
                    "read material type",
                    () => materialCell.locator("i[title]").first().getAttribute("title"),
                ),
            );
            const publicationDeadline = yield* parsePublicationDeadline(
                yield* readOptionalText(materialCell.locator("xpath=following-sibling::td[1]")),
            );
            if (type === "material") {
                const link = materialCell.locator("a");
                if ((yield* tryPromise("find material link", () => link.count())) === 0) {
                    materials.push({ name, type, publicationDeadline, resourceNames: null });
                    continue;
                }
                materials.push({ name, type, publicationDeadline, resourceNames: yield* getResourceNames(page, link) });
                continue;
            }
            materials.push({ name, type, publicationDeadline });
        }
        return materials;
    },
);

const getResourceNames = Effect.fn("PlaywrightBrowser.getResourceNames")(
    function* (
        page: playwright.Page,
        link: playwright.Locator,
    ): Effect.fn.Return<string[], CourseMaterialsGatewayError> {
        yield* tryPromise(
            "open material resources",
            () => link.evaluate((element) => (element as { click(): void }).click()),
        );
        yield* tryPromise(
            "wait for material resources",
            () => page.getByRole("columnheader", { name: "資料名", exact: true }).waitFor(),
        );
        const resourceNames =
            (yield* tryPromise("read resource names", () => page.locator('td[data-label="資料名"]').allTextContents()))
                .map(normalizeText);
        yield* tryPromise("return to course materials", () => page.locator(".lms-breadcrumb a").nth(1).click());
        yield* tryPromise("wait for course materials", () => page.locator(".courseFolderName").first().waitFor());
        return resourceNames;
    },
);

export function parseMaterialType(title: string | null): Effect.Effect<Material["type"], CourseMaterialsGatewayError> {
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
                new CourseMaterialsGatewayError({
                    operation: "parse material type",
                    message: `未対応の教材の種類: ${title}`,
                }),
            );
    }
}

export function parsePublicationDeadline(
    text: string | undefined,
): Effect.Effect<Material["publicationDeadline"], CourseMaterialsGatewayError> {
    if (text === "公開終了" || text === "Unavailable") return Effect.succeed("unavailable");
    return parseLmsDate(text).pipe(Effect.map((date) => date ?? "no-deadline"));
}

/** Parses an LMS date as Japan Standard Time. A date-only value means midnight JST. */
export function parseLmsDate(text: string | undefined): Effect.Effect<Date | undefined, CourseMaterialsGatewayError> {
    if (text === undefined) return Effect.succeed(undefined satisfies Date | undefined);
    const iso = text.replaceAll("/", "-").replace(" ", "T");
    return Effect.try({
        try: () => DateTime.toDate(DateTime.makeUnsafe(`${iso.includes("T") ? iso : `${iso}T00:00:00`}+09:00`)),
        catch: (cause) =>
            new CourseMaterialsGatewayError({ operation: "parse LMS date", message: errorMessage(cause) }),
    });
}

const readOptionalText = Effect.fn("PlaywrightBrowser.readOptionalText")(function* (
    locator: playwright.Locator,
): Effect.fn.Return<string | undefined, CourseMaterialsGatewayError> {
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
