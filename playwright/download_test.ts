import { assert, assertEquals, assertRejects } from "@std/assert";
import { Effect } from "effect";
import { chromium } from "playwright-core";
import { LmsSourceGatewayError } from "../core/out_port.ts";
import { downloadResourceFromResourcesPage } from "./resources.ts";

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
        const html = `<table><tr><th scope="col">資料名</th></tr>
            ${resource("Handout", "ファイル資料", `${target}/file`)}
            ${resource("Shared slides", "外部資料", `${origin}/redirect`, 'target="_blank"')}
            ${resource("Other resource", "動画資料", `${target}/unknown`)}
            ${resource("Direct URL", "外部資料", `${target}/shared`, 'target="_blank"')}
            </table>`;
        await context.route(
            `${origin}/**`,
            (route) =>
                new URL(route.request().url()).pathname === "/redirect"
                    ? route.fulfill({ status: 302, headers: { location: `${target}/shared?token=original` } })
                    : route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
        );
        await page.goto(resourcesUrl);

        await t.step("file contents persist after the browser context closes", async () => {
            const result = await Effect.runPromise(downloadResourceFromResourcesPage(page, 0));
            assert(result.type === "file");
            savedPath = result.path;
            assertEquals(await Deno.readTextFile(result.path), "test document");
            assert(result.path.endsWith("download-handout.pdf"));
            assertEquals(page.url(), resourcesUrl);
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
        await context.close();
        assert(savedPath !== undefined);
        assertEquals(await Deno.readTextFile(savedPath), "test document");
    } finally {
        await browser.close();
        abort.abort();
        await server.finished;
    }
});
