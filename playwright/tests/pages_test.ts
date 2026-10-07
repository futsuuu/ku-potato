import { assertEquals, assertRejects } from "@std/assert";
import { DateTime, Effect } from "effect";
import { chromium } from "playwright-core";
import { LmsAuthenticationRequiredError, LmsSourceGatewayError } from "../../core/out_port.ts";
import { LmsCourseId, LmsMaterialId } from "../../domain/mod.ts";
import { readCourseMaterials } from "../course.ts";
import { readMaterialResourcesFromCoursePage } from "../resources.ts";
import { hasAuthenticationState } from "../testing.ts";
import { loginToLms } from "../login.ts";

const homeUrl = "https://study.ns.kogakuin.ac.jp/lms/homeHoml/doIndex";
const courseUrl = "https://study.ns.kogakuin.ac.jp/lms/homeHoml/doLinkKougi";
const resourcesUrl = "https://study.ns.kogakuin.ac.jp/lms/corsColl/doLinkKyozaiTitle";
const homeHtml = `<span class="lms-search-condition-title">講義一覧</span>
    <div class="lms-weekly-area"><div class="lms-cardname">
        <a href="${courseUrl}" onclick="formSubmit('KOG1')">Example course</a>
    </div></div><script>function formSubmit() {}</script>`;
const courseHtml = `<table><thead><tr><th scope="col">授業実施日</th></tr></thead><tbody><tr class="accordionHeader">
    <td><span class="courseFolderName">Week 1</span></td><td class="checkStBoldJyugyoDy">2026/10/05</td>
    </tr><tr><td><table>
    <tr><td class="kyozaititleCell" id="SRY1"><i title="資料"></i><a href="${resourcesUrl}">Handout</a></td><td>2026/10/31 23:59</td></tr>
    <tr><td class="kyozaititleCell" id="SRY2"><i title="Materials"></i>Unpublished handout</td><td>公開終了</td></tr>
    <tr><td class="kyozaititleCell" id="REP1"><i title="レポート"></i>Report</td><td>－</td></tr>
    <tr><td class="kyozaititleCell" id="TST1"><i title="テスト"></i>Test</td><td>－</td></tr>
    <tr><td class="kyozaititleCell" id="QUE1"><i title="アンケート"></i>Questionnaire</td><td>－</td></tr>
    <tr><td class="kyozaititleCell" id="ELN1"><i title="e-Learning"></i>Learning</td><td>－</td></tr>
    </table></td></tr></tbody></table>`;

Deno.test({
    name: "Page contracts cover empty and unexpected states with controlled browser responses",
    ignore: !hasAuthenticationState,
    async fn(t) {
        const browser = await chromium.launch({ channel: "chrome", headless: true });
        try {
            const page = await browser.newPage();
            let courseResponse = courseHtml;
            let resourceResponse =
                '<table><tr><th scope="col">資料名</th></tr><tr><td data-label="資料名">Handout.pdf</td></tr></table>';
            let loginDestination = "https://study-auth.ns.kogakuin.ac.jp/eduapi/gknsso/CoursePower/";
            let showLoginInstruction = true;
            await page.route("https://study.ns.kogakuin.ac.jp/**", (route) => {
                const url = route.request().url();
                return route.fulfill({
                    contentType: "text/html; charset=utf-8",
                    body: url === "https://study.ns.kogakuin.ac.jp/lms"
                        ? `${
                            showLoginInstruction ? "<p>統合認証アカウントでログインします</p>" : ""
                        }<form action="${loginDestination}"><button name="loginButton">ログイン</button></form>`
                        : url === homeUrl
                        ? homeHtml
                        : url === courseUrl
                        ? courseResponse
                        : resourceResponse,
                });
            });
            await page.route("https://study-auth.ns.kogakuin.ac.jp/**", (route) =>
                route.fulfill({
                    contentType: "text/html",
                    body: `<script>setTimeout(() => location.href = '${homeUrl}', 200)</script>`,
                }));
            await page.route("https://slink.secioss.com/**", (route) => {
                if (new URL(route.request().url()).pathname === "/user") {
                    loginDestination = "https://study-auth.ns.kogakuin.ac.jp/eduapi/gknsso/CoursePower/";
                }
                return route.fulfill({
                    contentType: "text/html",
                    body: "<p>Authentication required</p>",
                });
            });

            await t.step("Login waits for SSO to finish instead of rejecting an intermediate origin", async () => {
                await Effect.runPromise(loginToLms(page, false));
                assertEquals(page.url(), homeUrl);
            });

            await t.step("Login still rejects an SSO timeout without prompting for interaction", async () => {
                loginDestination = "https://slink.secioss.com/sso/timeout.cgi";
                await assertRejects(() => Effect.runPromise(loginToLms(page, false)), LmsAuthenticationRequiredError);
            });

            await t.step("Interactive login returns through the SSO portal and verifies HOME", async () => {
                await Effect.runPromise(loginToLms(page, true));
                assertEquals(page.url(), homeUrl);
            });

            await t.step("Headless login rejects the SSO pre-login form without waiting for user input", async () => {
                loginDestination = "https://slink.secioss.com/pub/prelogin.cgi";
                await assertRejects(() => Effect.runPromise(loginToLms(page, false)), LmsAuthenticationRequiredError);
            });

            await t.step("A changed login page fails before clicking its login button", async () => {
                showLoginInstruction = false;
                page.setDefaultTimeout(1000);
                const error = await assertRejects(
                    () => Effect.runPromise(loginToLms(page, false)),
                    LmsSourceGatewayError,
                );
                assertEquals(error.operation, "verify KU-LMS login page");
                assertEquals(page.url(), "https://study.ns.kogakuin.ac.jp/lms");
                page.setDefaultTimeout(30000);
            });

            await t.step("Reads every material type, publication state, and folder date", async () => {
                await page.goto(homeUrl);
                const result = await Effect.runPromise(readCourseMaterials(page, LmsCourseId("KOG1")));
                assertEquals(result.folders.length, 1);
                const folder = result.folders[0];
                assertEquals(folder.name, "Week 1");
                assertEquals(folder.classDate?.toISOString(), "2026-10-04T15:00:00.000Z");
                assertEquals(folder.materials.map((material) => material.type), [
                    "material",
                    "material",
                    "report",
                    "test",
                    "questionnaire",
                    "e-learning",
                ]);
                assertEquals(folder.materials[0], {
                    lmsMaterialId: LmsMaterialId("SRY1"),
                    name: "Handout",
                    type: "material",
                    publicationDeadline: DateTime.toDate(DateTime.makeUnsafe("2026-10-31T14:59:00.000Z")),
                    resourceAvailability: "available",
                });
                assertEquals(folder.materials[1], {
                    lmsMaterialId: LmsMaterialId("SRY2"),
                    name: "Unpublished handout",
                    type: "material",
                    publicationDeadline: "unavailable",
                    resourceAvailability: "unavailable",
                });
                assertEquals(folder.materials[2].publicationDeadline, "no-deadline");
            });

            await t.step("An explicitly empty course returns no folders", async () => {
                courseResponse = "<p>授業が登録されていません。</p>";
                await page.goto(homeUrl);
                assertEquals(await Effect.runPromise(readCourseMaterials(page, LmsCourseId("KOG1"))), {
                    lmsCourseId: LmsCourseId("KOG1"),
                    folders: [],
                });
                courseResponse = courseHtml;
            });

            await t.step(
                "Reads resources after navigation and preserves an explicitly empty resource table",
                async () => {
                    await page.goto(courseUrl);
                    assertEquals(
                        await Effect.runPromise(readMaterialResourcesFromCoursePage(page, LmsMaterialId("SRY1"))),
                        [
                            { name: "Handout.pdf" },
                        ],
                    );
                    resourceResponse = '<table><tr><th scope="col">資料名</th></tr></table>';
                    await page.goto(courseUrl);
                    assertEquals(
                        await Effect.runPromise(readMaterialResourcesFromCoursePage(page, LmsMaterialId("SRY1"))),
                        [],
                    );
                },
            );

            await t.step("A changed resource page fails instead of returning a misleading empty list", async () => {
                resourceResponse = "<p>Unexpected page</p>";
                await page.goto(courseUrl);
                page.setDefaultTimeout(1000);
                const error = await assertRejects(
                    () => Effect.runPromise(readMaterialResourcesFromCoursePage(page, LmsMaterialId("SRY1"))),
                    LmsSourceGatewayError,
                );
                assertEquals(error.operation, "verify KU-LMS material resources page");
            });

            await t.step("A malformed material ID fails without producing a partial snapshot", async () => {
                courseResponse = courseHtml.replace('id="SRY1"', 'id="unexpected-id"');
                await page.goto(homeUrl);
                const error = await assertRejects(
                    () => Effect.runPromise(readCourseMaterials(page, LmsCourseId("KOG1"))),
                    LmsSourceGatewayError,
                );
                assertEquals(error.operation, "parse LMS material ID");
            });

            await t.step("Material cells on an unexpected URL cannot trigger resource navigation", async () => {
                await page.goto(homeUrl);
                await page.setContent(courseHtml);
                page.setDefaultNavigationTimeout(1000);
                const url = page.url();
                const error = await assertRejects(
                    () => Effect.runPromise(readMaterialResourcesFromCoursePage(page, LmsMaterialId("SRY1"))),
                    LmsSourceGatewayError,
                );
                assertEquals(error.operation, "verify KU-LMS course materials page");
                assertEquals(page.url(), url);
            });
        } finally {
            await browser.close();
        }
    },
});
