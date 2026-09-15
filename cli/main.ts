import * as gunshi from "gunshi";
import * as playwright from "playwright-core";

export async function main(commandArgs: string[]) {
    await gunshi.cli(commandArgs, async () => {
        await using browser = await launchBrowser({ headless: false });
        await using context = await browser.newContext();
        await using _storageStateWriter = await createStorageStateWriter(context, { path: ".storage-state.json" });
        const page = await context.newPage();
        await loginToLms(page);

        const courseNames = (await page.locator(".lms-cardname").allTextContents()).map(normalizeText);

        // - 各講義でURLが分かれておらず、ページを表示する際にはセッション情報を使って開いている講義を特定している
        //     - 複数講義を別々のタブで表示することはできるが、リロードすると最後に開いたタブの講義に切り替わる
        // - 複数タブで開くことはできても同時にリクエストを送ると失敗するので、複数ページで並行処理はできない
        for (const courseName of courseNames) {
            const course = await getCourseMaterials(page, courseName);
            printCourseMaterials(courseName, course);
        }
    }, {
        name: "ku-potato",
        version: "0.0.0",
        description: "Command-Line Interface for KU-PORT and KU-LMS",
    });
}

export type Material =
    & {
        name: string;
        publicationDeadline: Date | "no-deadline" | "unavailable";
    }
    & ({
        type: "material";
        /** LMSがリンクを提供していない場合はnull。資料がない場合は空配列。取得エラーは例外を送出する。 */
        resourceNames: string[] | null;
    } | {
        type: "report" | "test" | "questionnaire" | "e-learning";
    });

export type MaterialFolder = {
    name: string;
    classDate?: Date;
    materials: Material[];
};

export type CourseMaterials = {
    /** 講義概要が提供されていない講義ではnull。 */
    courseCode: string | null;
    /** 講義概要または教材フォルダーの授業実施日から取得できない場合はnull。 */
    year: number | null;
    folders: MaterialFolder[];
};

async function loginToLms(page: playwright.Page) {
    // SSOポータルはPlaywrightのウィンドウで接続タイムアウトすることがあるため、KU-LMSから遷移する。
    await page.goto("https://study.ns.kogakuin.ac.jp/lms");
    await page.locator("button[name='loginButton']").click();
    if (page.url().startsWith("https://slink.secioss.com/sso/timeout.cgi")) {
        await page.goto("https://slink.secioss.com/user");
        await page.waitForURL((url) => {
            const pathname = url.pathname;
            return url.hostname === "slink.secioss.com" &&
                (pathname === "/user" || pathname === "/user/" || pathname === "/user/index.php");
        }, { timeout: 10 * 60 * 1000 });
        await page.goto("https://study.ns.kogakuin.ac.jp/lms");
        await page.locator("button[name='loginButton']").click();
    } else {
        await page.waitForURL((url) => {
            return url.hostname === "study.ns.kogakuin.ac.jp" && url.pathname.startsWith("/lms/");
        }, { timeout: 10 * 60 * 1000 });
    }
}

/** HOMEを開いたPageと正確な講義名を受け取り、講義概要・教材を取得してHOMEへ戻る。利用不可はnull。 */
export async function getCourseMaterials(
    page: playwright.Page,
    courseName: string,
): Promise<CourseMaterials | null> {
    const courseCard = page.getByText(courseName, { exact: true });
    await courseCard.waitFor();
    const courseLink = courseCard.locator("a");
    if (await courseLink.count() === 0) return null;
    await courseLink.click();

    const noFoldersMessage = page.getByText("授業が登録されていません。", { exact: true });
    await page.locator(".courseFolderName").or(noFoldersMessage).first().waitFor();
    const overview = await getCourseOverview(page);
    const folders = await getMaterialFolders(page);
    if (folders.length === 0 && !await noFoldersMessage.isVisible()) {
        throw new Error(`教材フォルダーを取得できません: ${courseName}`);
    }
    await page.locator(".lms-breadcrumb a", { hasText: "HOME" }).click();
    await page.locator(".lms-weekly-area").waitFor();
    return {
        courseCode: overview?.courseCode ?? null,
        year: overview?.year ?? inferCourseYear(folders),
        folders,
    };
}

/** 教材一覧から講義概要を開き、講義コード・年度を取得して教材一覧へ戻る。 */
async function getCourseOverview(page: playwright.Page): Promise<Pick<CourseMaterials, "courseCode" | "year"> | null> {
    const overviewLink = page.getByRole("link", { name: "講義概要", exact: true });
    if (await overviewLink.count() === 0) return null;
    await overviewLink.click();
    const table = page.locator("table.lms-form-table");
    const courseCode = normalizeText(
        await table.locator("tr").filter({
            has: page.locator("th").filter({ hasText: /^講義コード$/ }),
        }).locator("td").innerText(),
    );
    const yearText = normalizeText(
        await table.locator("tr").filter({
            has: page.locator("th").filter({ hasText: /^年度$/ }),
        }).locator("td").innerText(),
    );
    if (courseCode === "") throw new Error("講義コードが空です");
    if (!/^\d{4}$/.test(yearText)) throw new Error(`年度を取得できません: ${yearText}`);
    await page.locator(".lms-breadcrumb a").nth(1).click();
    await page.locator(".courseFolderName").or(page.getByText("授業が登録されていません。", { exact: true })).first()
        .waitFor();
    return { courseCode, year: Number(yearText) };
}

function inferCourseYear(folders: MaterialFolder[]): number | null {
    const years = new Set(folders.flatMap((folder) => {
        if (folder.classDate === undefined) return [];
        return [
            Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Tokyo" }).format(folder.classDate)),
        ];
    }));
    return years.size === 1 ? [...years][0] : null;
}

async function getMaterialFolders(page: playwright.Page): Promise<MaterialFolder[]> {
    const folders: MaterialFolder[] = [];
    for (const folderRow of await page.locator("tr.accordionHeader").all()) {
        const name = normalizeText(await folderRow.locator(".courseFolderName").textContent() ?? "");
        const classDate = parseLmsDate(await readOptionalText(folderRow.locator("td.checkStBoldJyugyoDy")));
        const contentRow = folderRow.locator("xpath=following-sibling::tr[1]");
        const materials = await getMaterials(page, contentRow);
        folders.push({ name, ...(classDate === undefined ? {} : { classDate }), materials });
    }
    return folders;
}

async function getMaterials(
    page: playwright.Page,
    contentRow: playwright.Locator,
): Promise<Material[]> {
    const materials: Material[] = [];
    for (const materialCell of await contentRow.locator("td.kyozaititleCell").all()) {
        const name = normalizeText(await materialCell.textContent() ?? "");
        const type = parseMaterialType(await materialCell.locator("i[title]").first().getAttribute("title"));
        const deadlineText = await readOptionalText(materialCell.locator("xpath=following-sibling::td[1]"));
        const publicationDeadline = parsePublicationDeadline(deadlineText);
        if (type === "material") {
            const link = materialCell.locator("a");
            if (await link.count() === 0) {
                materials.push({ name, type, publicationDeadline, resourceNames: null });
                continue;
            }
            const resourceNames = await getResourceNames(page, link);
            materials.push({ name, type, publicationDeadline, resourceNames });
        } else {
            materials.push({ name, type, publicationDeadline });
        }
    }
    return materials;
}

/** 資料ページで名前だけを取得し、HOMEの隣の講義リンクから教材一覧へ戻る。 */
async function getResourceNames(page: playwright.Page, link: playwright.Locator): Promise<string[]> {
    // 折りたたみ内でもリンクはDOMに存在する。ネイティブクリックなら不安定な展開アニメーションを経由しない。
    await link.evaluate((element: { click(): void }) => element.click());
    await page.getByRole("columnheader", { name: "資料名", exact: true }).waitFor();
    const resourceNames = (await page.locator('td[data-label="資料名"]').allTextContents()).map(normalizeText);
    await page.locator(".lms-breadcrumb a").nth(1).click();
    await page.locator(".courseFolderName").first().waitFor();
    return resourceNames;
}

export function parseMaterialType(title: string | null): Material["type"] {
    switch (title) {
        case "Materials":
        case "資料":
            return "material";
        case "e-Learning":
        case "e-learning":
            return "e-learning";
        case "Report":
        case "レポート":
            return "report";
        case "Test":
        case "テスト":
            return "test";
        case "Questionnaire":
        case "アンケート":
            return "questionnaire";
        default:
            throw new Error(`未対応の教材の種類: ${title}`);
    }
}

export function parsePublicationDeadline(text: string | undefined): Material["publicationDeadline"] {
    // 公開終了の場合、一覧には実際の期限が表示されない。
    if (text === "公開終了" || text === "Unavailable") return "unavailable";
    return parseLmsDate(text) ?? "no-deadline";
}

/** LMSの日本時間をDateに変換する。日付のみの場合は日本時間の午前0時。 */
export function parseLmsDate(text: string | undefined): Date | undefined {
    if (text === undefined) return undefined;
    const iso = text.replaceAll("/", "-").replace(" ", "T");
    return new Date(`${iso.includes("T") ? iso : `${iso}T00:00:00`}+09:00`);
}

async function readOptionalText(locator: playwright.Locator): Promise<string | undefined> {
    const text = normalizeText(await locator.textContent() ?? "");
    return text === "" || /^[-‐‑‒–—―－]+$/.test(text) ? undefined : text;
}

function printCourseMaterials(courseName: string, course: CourseMaterials | null) {
    console.log(`講義名: ${courseName}`);
    if (course === null) {
        console.log("  利用不可");
        return;
    }
    console.log(`  講義コード: ${course.courseCode ?? "不明"}`);
    console.log(`  年度: ${course.year ?? "不明"}`);
    const folders = course.folders;
    if (folders.length === 0) console.log("  教材フォルダー名: （なし）");
    for (const folder of folders) {
        console.log(`  教材フォルダー名: ${folder.name}`);
        if (folder.classDate !== undefined) console.log(`    授業実施日: ${folder.classDate.toISOString()}`);
        if (folder.materials.length === 0) console.log("    教材名: （なし）");
        for (const material of folder.materials) {
            console.log(`    教材名: ${material.name}`);
            console.log(`      種類: ${material.type}`);
            const deadline = material.publicationDeadline;
            console.log(`      公開期限: ${deadline instanceof Date ? deadline.toISOString() : deadline}`);
            if (material.type === "material") {
                if (material.resourceNames === null) console.log("      資料名: （未公開）");
                else if (material.resourceNames.length === 0) console.log("      資料名: （なし）");
                else for (const name of material.resourceNames) console.log(`      資料名: ${name}`);
            }
        }
    }
}

function normalizeText(text: string) {
    return text.replace(/\s+/g, " ").trim();
}

function launchBrowser(opts: { headless: boolean }) {
    return playwright.chromium.launch({
        channel: "chrome",
        headless: opts.headless,
        args: [
            "--disable-blink-features=AutomationControlled",
        ],
    });
}

async function createStorageStateWriter(context: playwright.BrowserContext, opts: {
    path: string;
}) {
    await context.setStorageState(opts.path).catch(() => {});
    return {
        async [Symbol.asyncDispose]() {
            await Deno.writeTextFile(opts.path, JSON.stringify(await context.storageState()));
        },
    };
}

if (import.meta.main) {
    await main(Deno.args);
}
