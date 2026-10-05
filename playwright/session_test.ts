import { assertEquals, assertRejects } from "@std/assert";
import { Effect } from "effect";
import { chromium } from "playwright-core";
import { LmsMaterialNotFoundError, LmsSourceGatewayError } from "../core/out_port.ts";
import { LmsCourseId, LmsMaterialId } from "../domain/mod.ts";
import { makeLmsSourceSession } from "./session.ts";

const origin = "https://study.ns.kogakuin.ac.jp";
const homeUrl = `${origin}/lms/homeHoml/doIndex`;
const courseUrl = `${origin}/lms/homeHoml/doLinkKougi`;
const resourcesUrl = `${origin}/lms/corsColl/doLinkKyozaiTitle`;

Deno.test("source sessions prioritize cached ownership and safely fall back using controlled browser responses", async (t) => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(1500);
        page.setDefaultNavigationTimeout(1500);
        const visitedCourses: string[] = [];
        let homeVersion = 0;
        let brokenCourse = false;
        await page.route(`${origin}/**`, (route) => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith("/lms/homeRedirect/")) {
                return route.fulfill({
                    contentType: "text/html",
                    body: `<script>location.replace('${homeUrl}')</script>`,
                });
            }
            let body: string;
            if (url.pathname === "/lms/homeHoml/doIndex") {
                body = `<span class="lms-search-condition-title">講義一覧</span><div class="lms-weekly-area">${
                    ["KOG1", "KOG2", "KOG3", "KOG2"].map((id) =>
                        `<div class="lms-cardname"><a href="${courseUrl}?course=${id}" onclick="formSubmit('${id}')">Course ${id} v${homeVersion}</a></div>`
                    ).join("")
                }</div><script>function formSubmit() {}</script>`;
            } else if (url.pathname === "/lms/homeHoml/doLinkKougi") {
                const id = url.searchParams.get("course")!;
                visitedCourses.push(id);
                body = brokenCourse
                    ? "Unexpected course page"
                    : id === "KOG1"
                    ? "<p>授業が登録されていません。</p>"
                    : `<table><thead><tr><th scope="col">授業実施日</th></tr></thead><tbody>
                        <tr class="accordionHeader"><td><span class="courseFolderName">Week 1</span></td><td class="checkStBoldJyugyoDy">－</td></tr>
                        <tr><td><table>${
                        id === "KOG2"
                            ? `<tr><td class="kyozaititleCell" id="SRY1"><i title="資料"></i><a href="${resourcesUrl}">Handout</a></td><td>－</td></tr>`
                            : '<tr><td class="kyozaititleCell" id="REP1"><i title="レポート"></i>Report</td><td>－</td></tr><tr><td class="kyozaititleCell" id="SRY2"><i title="資料"></i>Unpublished handout</td><td>公開終了</td></tr>'
                    }</table></td></tr></tbody></table>`;
            } else {
                body =
                    '<table><tr><th scope="col">資料名</th></tr><tr><td data-label="資料名">Handout.pdf</td></tr></table>';
            }
            return route.fulfill({
                contentType: "text/html; charset=utf-8",
                body: `${body}<a href="/lms/homeRedirect/doIndex">HOME</a>`,
            });
        });
        await page.goto(homeUrl);
        const session = makeLmsSourceSession(page);
        for (
            const [hint, expected] of [
                ["KOG2", ["KOG2"]],
                [undefined, ["KOG1", "KOG2"]],
                ["KOG1", ["KOG1", "KOG2"]],
                ["KOG3", ["KOG3", "KOG1", "KOG2"]],
                ["MISSING", ["KOG1", "KOG2"]],
            ] as const
        ) {
            await t.step(`fetches resources with course hint ${hint}`, async () => {
                visitedCourses.length = 0;
                const snapshot = await Effect.runPromise(session.fetchMaterialResources(
                    LmsMaterialId("SRY1"),
                    hint === undefined ? undefined : LmsCourseId(hint),
                ));
                assertEquals(snapshot.materialResources, {
                    lmsMaterialId: LmsMaterialId("SRY1"),
                    resources: [{ name: "Handout.pdf" }],
                });
                assertEquals(snapshot.courseMaterials.lmsCourseId, LmsCourseId("KOG2"));
                assertEquals(visitedCourses, [...expected]);
            });
        }
        await t.step("reuses the course index until explicitly refreshed", async () => {
            homeVersion = 1;
            const cached = await Effect.runPromise(session.fetchCourseMaterials(LmsCourseId("KOG2")));
            assertEquals(cached.courses[0]?.name, "Course KOG1 v0");
            const refreshed = await Effect.runPromise(session.fetchCourses);
            assertEquals(refreshed[0]?.name, "Course KOG1 v1");
            const updated = await Effect.runPromise(session.fetchCourseMaterials(LmsCourseId("KOG3")));
            assertEquals(updated.courses, refreshed);
        });
        await t.step("serializes concurrent operations on the shared tab", async () => {
            const [resources, materials] = await Promise.all([
                Effect.runPromise(session.fetchMaterialResources(LmsMaterialId("SRY1"), LmsCourseId("KOG2"))),
                Effect.runPromise(session.fetchCourseMaterials(LmsCourseId("KOG3"))),
            ]);
            assertEquals(resources.courseMaterials.lmsCourseId, LmsCourseId("KOG2"));
            assertEquals(materials.courseMaterials.lmsCourseId, LmsCourseId("KOG3"));
        });
        for (const id of ["REP1", "SRY2"]) {
            await t.step(`returns no resources for ${id}`, async () => {
                visitedCourses.length = 0;
                const snapshot = await Effect.runPromise(
                    session.fetchMaterialResources(LmsMaterialId(id), LmsCourseId("KOG3")),
                );
                assertEquals(snapshot.materialResources.resources, []);
                assertEquals(visitedCourses, ["KOG3"]);
            });
        }
        await t.step("reports a missing material after checking every available course once", async () => {
            visitedCourses.length = 0;
            await assertRejects(
                () =>
                    Effect.runPromise(
                        session.fetchMaterialResources(LmsMaterialId("SRY_MISSING"), LmsCourseId("KOG3")),
                    ),
                LmsMaterialNotFoundError,
            );
            assertEquals(visitedCourses, ["KOG3", "KOG1", "KOG2"]);
        });
        await t.step("fails on an unexpected course page instead of hiding the source error", async () => {
            brokenCourse = true;
            visitedCourses.length = 0;
            page.setDefaultTimeout(500);
            await assertRejects(
                () => Effect.runPromise(session.fetchMaterialResources(LmsMaterialId("SRY1"), LmsCourseId("KOG2"))),
                LmsSourceGatewayError,
            );
            assertEquals(visitedCourses, ["KOG2"]);
        });
    } finally {
        await browser.close();
    }
});
