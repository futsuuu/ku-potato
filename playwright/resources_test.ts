import { assert, assertEquals, assertRejects } from "@std/assert";
import { Effect } from "effect";
import { chromium } from "playwright-core";
import { LmsSourceGatewayError } from "../core/out_port.ts";
import { type LmsCourseId, LmsMaterialId, LmsResourceId, type Material } from "../domain/mod.ts";
import { readCourseMaterials } from "./course.ts";
import { openLmsHome, readCourses } from "./home.ts";
import {
    downloadResourceFromResourcesPage,
    readMaterialResourcesFromCoursePage,
    readMaterialResourcesFromResourcesPage,
    verifyMaterialResources,
} from "./resources.ts";
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

const origin = "https://study.ns.kogakuin.ac.jp";
const resourcesUrl = `${origin}/lms/corsColl/doLinkKyozaiTitle`;

Deno.test("resource retrieval saves files and captures external URLs before redirects", async (t) => {
    const abort = new AbortController();
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, signal: abort.signal, onListen() {} }, (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/file") {
            return new Response("test document", {
                headers: {
                    "Content-Type": "application/octet-stream",
                    "Content-Disposition": 'attachment; filename="handout.pdf"',
                },
            });
        }
        if (url.pathname === "/shared") return Response.redirect(new URL("/login", url));
        return new Response("Sign in", { headers: { "Content-Type": "text/html" } });
    });
    const target = `http://127.0.0.1:${server.addr.port}`;
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    let savedPath: string | undefined;
    try {
        const context = await browser.newContext({ acceptDownloads: true });
        const page = await context.newPage();
        page.setDefaultTimeout(1000);
        const resource = (name: string, kind: string, href: string, attributes = "") =>
            `<tr><td data-label="資料名"><i title="${kind}"><a href="${href}" ${attributes}>${name}</a></i><a href="${href}" ${attributes}></a></td></tr>`;
        const externalHandler = (id: string, url: string, path: string) =>
            `javascript:openWindow('${origin}${path}?syosaiId=${id}&fileurl=${encodeURIComponent(url)}','','')`;
        const html = `<script>
            function downloadFile(fileId, syosaiId) { location.href = '${target}/file'; }
            function openWindow(url) { window.open(url); }
            </script><table><tr><th scope="col">資料名</th></tr>
            ${resource("Handout", "ファイル資料", "javascript:downloadFile('FIL0000000000001','SRS0000000000001')")}
            ${
            resource(
                "Shared slides",
                "外部資料",
                externalHandler("SRS0000000000002", `${target}/shared?token=original`, "/redirect"),
            )
        }
            ${resource("Other resource", "動画資料", "javascript:unsupportedHandler('SRS0000000000003')")}
            ${resource("Direct URL", "外部資料", externalHandler("SRS0000000000004", `${target}/shared`, "/direct"))}
            </table>`;
        await context.route(
            `${origin}/**`,
            (route) =>
                ["/redirect", "/direct"].includes(new URL(route.request().url()).pathname)
                    ? route.fulfill({
                        status: 302,
                        headers: { location: new URL(route.request().url()).searchParams.get("fileurl")! },
                    })
                    : route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
        );
        await page.goto(resourcesUrl);

        await t.step("listing extracts detail IDs, original URLs, and unknown kinds without navigation", async () => {
            const requested: string[] = [];
            const observe = (request: { url(): string }) => requested.push(request.url());
            context.on("request", observe);
            try {
                const resources = await Effect.runPromise(readMaterialResourcesFromResourcesPage(page));
                assertEquals(resources, [
                    {
                        name: "Handout",
                        lmsResourceId: LmsResourceId("SRS0000000000001"),
                        type: "file",
                        sourceKind: "ファイル資料",
                    },
                    {
                        name: "Shared slides",
                        lmsResourceId: LmsResourceId("SRS0000000000002"),
                        type: "external",
                        sourceKind: "外部資料",
                        url: `${target}/shared?token=original`,
                    },
                    {
                        name: "Other resource",
                        lmsResourceId: LmsResourceId("SRS0000000000003"),
                        type: "unsupported",
                        sourceKind: "動画資料",
                    },
                    {
                        name: "Direct URL",
                        lmsResourceId: LmsResourceId("SRS0000000000004"),
                        type: "external",
                        sourceKind: "外部資料",
                        url: `${target}/shared`,
                    },
                ]);
                assertEquals(requested, []);
            } finally {
                context.off("request", observe);
            }
        });

        await t.step("missing, malformed, and duplicate detail IDs fail the whole listing", async () => {
            const link = page.locator('td[data-label="資料名"]').nth(0).getByRole("link").first();
            const original = await link.getAttribute("href");
            for (
                const handler of [
                    "javascript:downloadFile('FIL0000000000001','')",
                    "javascript:downloadFile('FIL0000000000001','invalid')",
                    "javascript:downloadFile('FIL0000000000001','SRS0000000000002')",
                ]
            ) {
                // Both links in the cell share the real LMS handler.
                await page.locator('td[data-label="資料名"]').nth(0).locator("a").evaluateAll(
                    (links, href) => links.forEach((link) => link.setAttribute("href", href)),
                    handler,
                );
                await assertRejects(
                    () => Effect.runPromise(readMaterialResourcesFromResourcesPage(page)),
                    LmsSourceGatewayError,
                );
            }
            await page.locator('td[data-label="資料名"]').nth(0).locator("a").evaluateAll(
                (links, href) => links.forEach((link) => link.setAttribute("href", href!)),
                original,
            );
        });

        await t.step("file contents persist after the browser context closes", async () => {
            const temporaryPath = page.waitForEvent("download").then((download) => download.path());
            const result = await Effect.runPromise(downloadResourceFromResourcesPage(page, 0));
            assert(result.type === "file");
            savedPath = result.path;
            assertEquals(await Deno.readTextFile(result.path), "test document");
            assert(result.path.endsWith("download-handout.pdf"));
            assertEquals(result.originalFilename, "handout.pdf");
            assertEquals(page.url(), resourcesUrl);
            const downloadedPath = await temporaryPath;
            assert(downloadedPath !== null);
            await assertRejects(() => Deno.stat(downloadedPath), Deno.errors.NotFound);
        });
        for (const [position, expected] of [[1, `${target}/shared?token=original`], [3, `${target}/shared`]] as const) {
            await t.step(`external position ${position} returns the shared URL and closes its popup`, async () => {
                assertEquals(await Effect.runPromise(downloadResourceFromResourcesPage(page, position)), {
                    type: "external",
                    url: expected,
                });
                assertEquals(context.pages().length, 1);
                assertEquals(page.url(), resourcesUrl);
            });
        }
        for (const position of [2, 4, -1, 0.5, NaN]) {
            await t.step(`unsupported resource or position ${position} fails without navigation`, async () => {
                await assertRejects(
                    () => Effect.runPromise(downloadResourceFromResourcesPage(page, position)),
                    LmsSourceGatewayError,
                );
                assertEquals(page.url(), resourcesUrl);
                assertEquals(context.pages().length, 1);
            });
        }
        await t.step("resource ID retrieval follows reordered rows instead of old positions", async () => {
            await page.locator('td[data-label="資料名"]').nth(0).evaluate((cell) =>
                cell.parentElement!.parentElement!.append(cell.parentElement!)
            );
            const result = await Effect.runPromise(
                downloadResourceFromResourcesPage(page, LmsResourceId("SRS0000000000001")),
            );
            assert(result.type === "file");
            assertEquals(await Deno.readTextFile(result.path), "test document");
            await assertRejects(
                () => Effect.runPromise(downloadResourceFromResourcesPage(page, LmsResourceId("SRS9999999999999"))),
                LmsSourceGatewayError,
            );
        });
        await t.step("external URLs retain fragments and can share the LMS origin", async () => {
            const source = `${origin}/shared-page#slide-2`;
            await page.locator("tbody").evaluate(
                (table, html) => table.insertAdjacentHTML("beforeend", html),
                resource("Same origin", "外部資料", externalHandler("SRS0000000000005", source, "/direct")),
            );
            assertEquals(
                await Effect.runPromise(downloadResourceFromResourcesPage(page, LmsResourceId("SRS0000000000005"))),
                { type: "external", url: source },
            );
            assertEquals(context.pages().length, 1);
        });
        await context.close();
        assert(savedPath !== undefined);
        assertEquals(await Deno.readTextFile(savedPath), "test document");
    } finally {
        await browser.close();
        abort.abort();
        await server.finished;
    }
});
