import { assert, assertEquals, assertRejects } from "@std/assert";
import { Effect } from "effect";
import { LmsCourseNotFoundError, LmsSourceGatewayError } from "../core/out_port.ts";
import { LmsCourseId } from "../domain/mod.ts";
import { openCourseMaterials, readCourseMaterials } from "./course.ts";
import { openLmsHome, readCourses } from "./home.ts";
import { hasAuthenticationState, withAuthenticatedPage } from "./testing.ts";

Deno.test({
    name: "KU-LMS course materials verify navigation and read the live material folders",
    ignore: !hasAuthenticationState,
    async fn(t) {
        await withAuthenticatedPage(async (page) => {
            const courses = await Effect.runPromise(readCourses(page));
            const course = courses.find((candidate) => candidate.availability === "available");
            await t.step({
                name: "Reads all folders and material cells for the selected course",
                ignore: course === undefined,
                async fn() {
                    assert(course !== undefined);
                    const result = await Effect.runPromise(readCourseMaterials(page, course.lmsCourseId));
                    assertEquals(result.lmsCourseId, course.lmsCourseId);
                    assertEquals(result.folders.length, await page.locator("tr.accordionHeader").count());
                    assertEquals(
                        result.folders.flatMap((folder) => folder.materials).length,
                        await page.locator("td.kyozaititleCell").count(),
                    );
                    for (const folder of result.folders) {
                        assert(folder.name.length > 0, "Each material folder must have a name.");
                        if (folder.classDate !== undefined) assert(Number.isFinite(folder.classDate.getTime()));
                    }
                    await Effect.runPromise(openLmsHome(page));
                    assertEquals(await Effect.runPromise(readCourses(page)), courses);
                },
            });

            await t.step("A missing course fails without leaving HOME", async () => {
                const url = page.url();
                const error = await assertRejects(
                    () => Effect.runPromise(openCourseMaterials(page, LmsCourseId("KU_POTATO_MISSING_COURSE"))),
                    LmsCourseNotFoundError,
                );
                assertEquals(error.lmsCourseId, "KU_POTATO_MISSING_COURSE");
                assertEquals(page.url(), url);
            });

            await t.step({
                name: "A changed HOME fails before clicking a course",
                ignore: course === undefined,
                async fn() {
                    assert(course !== undefined);
                    const url = page.url();
                    await page.locator(".lms-search-condition-title").evaluate((heading) => heading.remove());
                    page.setDefaultTimeout(1000);
                    const error = await assertRejects(
                        () => Effect.runPromise(openCourseMaterials(page, course.lmsCourseId)),
                        LmsSourceGatewayError,
                    );
                    assertEquals(error.operation, "verify KU-LMS course list heading");
                    assertEquals(page.url(), url);
                },
            });
        });
    },
});
