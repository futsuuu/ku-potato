import { Effect } from "effect";
import type { Locator, Page } from "playwright-core";
import { LmsCourseNotFoundError, LmsSourceGatewayError } from "../core/out_port.ts";
import type { CourseMaterials, LmsCourseId, Material, MaterialFolder } from "../domain/mod.ts";
import { parseLmsCourseId, verifyLmsHome } from "./home.ts";
import {
    normalizeText,
    parseLmsDate,
    parseLmsMaterialId,
    parseMaterialType,
    parsePublicationDeadline,
    readOptionalText,
} from "./parsing.ts";
import { tryPromise } from "./promise.ts";

/** Accepts both routes used by KU-LMS for the course's material list. */
export const verifyCourseMaterials = Effect.fn("PlaywrightBrowser.verifyCourseMaterials")(function* (page: Page) {
    yield* tryPromise(
        "verify KU-LMS course materials page",
        () =>
            page.waitForURL((url) =>
                url.protocol === "https:" && url.hostname === "study.ns.kogakuin.ac.jp" &&
                /^\/lms\/(?:homeHoml\/doLinkKougi|corsColl\/doIndex)(?:;|$)/.test(url.pathname)
            ),
    );
    const noFoldersMessage = page.getByText("授業が登録されていません。", { exact: true });
    yield* tryPromise(
        "verify KU-LMS course materials heading",
        () =>
            page.getByRole("columnheader", { name: "授業実施日", exact: true }).or(noFoldersMessage).first().waitFor(),
    );
    yield* tryPromise(
        "wait for course materials",
        () => page.locator(".courseFolderName").or(noFoldersMessage).first().waitFor(),
    );
});

export const readCourseMaterials = Effect.fn("PlaywrightBrowser.readCourseMaterials")(function* (
    page: Page,
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

export const openCourseMaterials = Effect.fn("PlaywrightBrowser.openCourseMaterials")(function* (
    page: Page,
    lmsCourseId: LmsCourseId,
): Effect.fn.Return<void, LmsSourceGatewayError | LmsCourseNotFoundError> {
    yield* verifyLmsHome(page);
    let courseLink: Locator | undefined;
    for (
        const candidate of yield* tryPromise(
            "find course links",
            () => page.locator(".lms-weekly-area .lms-cardname a").all(),
        )
    ) {
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
            message: `Cannot find the course on KU-LMS HOME: ${lmsCourseId}`,
        });
    }
    yield* tryPromise("open course", () => courseLink.click());
    yield* verifyCourseMaterials(page);
});

const readMaterialFolderInfo = Effect.fn("PlaywrightBrowser.readMaterialFolderInfo")(function* (
    folderRow: Locator,
): Effect.fn.Return<Omit<MaterialFolder, "materials">, LmsSourceGatewayError> {
    const name = normalizeText(
        (yield* tryPromise("read material folder name", () => folderRow.locator(".courseFolderName").textContent())) ??
            "",
    );
    const classDate = yield* parseLmsDate(yield* readOptionalText(folderRow.locator("td.checkStBoldJyugyoDy")));
    return { name, ...(classDate === undefined ? {} : { classDate }) };
});

const readCourseMaterial = Effect.fn("PlaywrightBrowser.readCourseMaterial")(function* (
    materialCell: Locator,
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
