import { assert, assertEquals, assertRejects } from "@std/assert";
import { Effect } from "effect";
import { LmsSourceGatewayError } from "../core/out_port.ts";
import { type LmsCourseId, LmsMaterialId, type Material } from "../domain/mod.ts";
import { readCourseMaterials } from "./course.ts";
import { openLmsHome, readCourses } from "./home.ts";
import { readMaterialResourcesFromCoursePage, verifyMaterialResources } from "./resources.ts";
import { hasAuthenticationState, withAuthenticatedPage } from "./testing.ts";

Deno.test({
    name: "KU-LMS material resources verify the live resources page and reject unexpected states",
    ignore: !hasAuthenticationState,
    async fn(t) {
        await withAuthenticatedPage(async (page) => {
            const courses = await Effect.runPromise(readCourses(page));
            let selected: { courseId: LmsCourseId; material: Material } | undefined;
            for (const course of courses) {
                if (course.availability !== "available") continue;
                await Effect.runPromise(openLmsHome(page));
                const result = await Effect.runPromise(readCourseMaterials(page, course.lmsCourseId));
                const material = result.folders.flatMap((folder) => folder.materials).find((material) =>
                    material.type === "material" && material.resourceAvailability === "available"
                );
                if (material !== undefined) {
                    selected = { courseId: course.lmsCourseId, material };
                    break;
                }
            }

            await t.step({
                name: "Reads every displayed resource name for a published material",
                ignore: selected === undefined,
                async fn() {
                    assert(selected !== undefined);
                    const resources = await Effect.runPromise(
                        readMaterialResourcesFromCoursePage(page, selected.material.lmsMaterialId),
                    );
                    assertEquals(resources.length, await page.locator('td[data-label="資料名"]').count());
                    for (const resource of resources) assert(resource.name.length > 0, "A resource must have a name.");
                    assertEquals(
                        await page.getByRole("columnheader", { name: "資料名", exact: true }).isVisible(),
                        true,
                    );
                },
            });

            await t.step({
                name: "A missing resources header fails even when resource name cells remain",
                ignore: selected === undefined,
                async fn() {
                    await page.getByRole("columnheader", { name: "資料名", exact: true }).evaluate((header) =>
                        header.remove()
                    );
                    page.setDefaultTimeout(1000);
                    const error = await assertRejects(
                        () => Effect.runPromise(verifyMaterialResources(page)),
                        LmsSourceGatewayError,
                    );
                    assertEquals(error.operation, "verify KU-LMS material resources page");
                    page.setDefaultTimeout(30000);
                },
            });

            await t.step({
                name: "A missing material fails without navigating away from the course",
                ignore: selected === undefined,
                async fn() {
                    assert(selected !== undefined);
                    await Effect.runPromise(openLmsHome(page));
                    await Effect.runPromise(readCourseMaterials(page, selected.courseId));
                    const url = page.url();
                    const error = await assertRejects(
                        () =>
                            Effect.runPromise(
                                readMaterialResourcesFromCoursePage(page, LmsMaterialId("SRY0000000000000")),
                            ),
                        LmsSourceGatewayError,
                    );
                    assertEquals(error.operation, "find material");
                    assertEquals(page.url(), url);
                },
            });

            await t.step({
                name: "An unpublished material fails before clicking any resource link",
                ignore: selected === undefined,
                async fn() {
                    assert(selected !== undefined);
                    const materialId = selected.material.lmsMaterialId;
                    await page.locator(`td.kyozaititleCell#${materialId} a`).evaluate((link) => link.remove());
                    const url = page.url();
                    const error = await assertRejects(
                        () => Effect.runPromise(readMaterialResourcesFromCoursePage(page, materialId)),
                        LmsSourceGatewayError,
                    );
                    assertEquals(error.operation, "find material resource link");
                    assertEquals(page.url(), url);
                },
            });

            await t.step({
                name: "A changed course heading prevents a material click even when material cells remain",
                ignore: selected === undefined,
                async fn() {
                    assert(selected !== undefined);
                    await page.getByRole("columnheader", { name: "授業実施日", exact: true }).evaluate((header) =>
                        header.remove()
                    );
                    page.setDefaultTimeout(1000);
                    const url = page.url();
                    const error = await assertRejects(
                        () =>
                            Effect.runPromise(
                                readMaterialResourcesFromCoursePage(page, selected.material.lmsMaterialId),
                            ),
                        LmsSourceGatewayError,
                    );
                    assertEquals(error.operation, "verify KU-LMS course materials heading");
                    assertEquals(page.url(), url);
                },
            });
        });
    },
});
