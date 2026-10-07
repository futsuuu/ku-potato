import { assert, assertEquals, assertRejects } from "@std/assert";
import { Effect, Exit } from "effect";
import { LmsSourceGatewayError } from "../core/out_port.ts";
import { openLmsHome, parseLmsCourseId, readCourses } from "./home.ts";
import { hasAuthenticationState, withAuthenticatedPage } from "./testing.ts";

Deno.test({
    name: "KU-LMS course retrieval verifies HOME using the application's saved authentication",
    ignore: !hasAuthenticationState,
    async fn(t) {
        await withAuthenticatedPage(async (page) => {
            await t.step("Reads every displayed course and preserves link availability", async () => {
                await Effect.runPromise(openLmsHome(page));
                const courses = await Effect.runPromise(readCourses(page));
                const courseIndex = page.locator(".lms-weekly-area");
                assertEquals(courses.length, await courseIndex.locator(".lms-cardname").count());
                assertEquals(
                    courses.filter((course) => course.availability === "available").length,
                    await courseIndex.locator(".lms-cardname a").count(),
                );
                for (const course of courses) {
                    assert(course.name.length > 0, "Each course must have a non-empty name.");
                    assertEquals(course.name, course.name.trim());
                    if (course.availability === "available") {
                        assert(course.lmsCourseId.length > 0, "Each available course must have an LMS course ID.");
                    }
                }
            });

            await t.step("Returns an empty list when the identified HOME has no courses", async () => {
                await page.locator(".lms-weekly-area .lms-cardname").evaluateAll((cards) => {
                    for (const card of cards) card.remove();
                });
                assertEquals(await Effect.runPromise(readCourses(page)), []);
            });

            await t.step("Rejects a changed page instead of treating it as an empty course list", async () => {
                await page.locator(".lms-search-condition-title").evaluate((heading) => heading.remove());
                page.setDefaultTimeout(1000);
                for (const operation of [openLmsHome, readCourses]) {
                    const error = await assertRejects(
                        () => Effect.runPromise(operation(page)),
                        LmsSourceGatewayError,
                    );
                    assertEquals(error.operation, "verify KU-LMS course list heading");
                }
            });
        });
    },
});

Deno.test("Extracts LMS course IDs from course click handlers", () => {
    assertEquals(Effect.runSync(parseLmsCourseId("formSubmit('KOG0000000066101')")), "KOG0000000066101");
    assertEquals(Exit.isFailure(Effect.runSyncExit(parseLmsCourseId("openCourse('KOG1')"))), true);
});
