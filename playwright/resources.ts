import { Effect } from "effect";
import type { Page } from "playwright-core";
import { LmsSourceGatewayError } from "../core/out_port.ts";
import type { LmsMaterialId, Resource } from "../domain/mod.ts";
import { normalizeText } from "./parsing.ts";
import { tryPromise } from "./promise.ts";
import { verifyCourseMaterials } from "./course.ts";

/** Identifies the resources page independently of resource name cells. */
export const verifyMaterialResources = Effect.fn("PlaywrightBrowser.verifyMaterialResources")(function* (page: Page) {
    yield* tryPromise(
        "verify KU-LMS material resources URL",
        () =>
            page.waitForURL((url) =>
                url.protocol === "https:" && url.hostname === "study.ns.kogakuin.ac.jp" &&
                /^\/lms\/corsColl\/doLinkKyozaiTitle(?:;|$)/.test(url.pathname)
            ),
    );
    yield* tryPromise(
        "verify KU-LMS material resources page",
        () => page.getByRole("columnheader", { name: "資料名", exact: true }).waitFor(),
    );
});

export const readMaterialResourcesFromCoursePage = Effect.fn("PlaywrightBrowser.readMaterialResourcesFromCoursePage")(
    function* (
        page: Page,
        lmsMaterialId: LmsMaterialId,
    ): Effect.fn.Return<Resource[], LmsSourceGatewayError> {
        yield* verifyCourseMaterials(page);
        const materialCell = page.locator(`td.kyozaititleCell#${lmsMaterialId}`);
        if ((yield* tryPromise("find material", () => materialCell.count())) === 0) {
            return yield* new LmsSourceGatewayError({
                operation: "find material",
                message: `Cannot find the material on the course page: ${lmsMaterialId}`,
            });
        }
        const materialLink = materialCell.locator("a");
        if ((yield* tryPromise("find material resource link", () => materialLink.count())) === 0) {
            return yield* new LmsSourceGatewayError({
                operation: "find material resource link",
                message: `The material resources are not published: ${lmsMaterialId}`,
            });
        }
        yield* tryPromise(
            "open material resources",
            () => materialLink.evaluate((element) => (element as { click(): void }).click()),
        );
        yield* verifyMaterialResources(page);
        return (yield* tryPromise(
            "read resource names",
            () => page.locator('td[data-label="資料名"]').allTextContents(),
        ))
            .map(normalizeText)
            .map((name): Resource => ({ name }));
    },
);
