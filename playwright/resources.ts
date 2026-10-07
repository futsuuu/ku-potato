import { Effect, Schema } from "effect";
import type { Page, Request } from "playwright-core";
import { LmsSourceGatewayError } from "../core/out_port.ts";
import { type LmsMaterialId, LmsResourceId, type Resource, type ResourceDownload } from "../domain/mod.ts";
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
        return yield* readMaterialResourcesFromResourcesPage(page);
    },
);

/** Reads stable detail IDs and URLs without opening any external resource. */
export const readMaterialResourcesFromResourcesPage = Effect.fn(
    "PlaywrightBrowser.readMaterialResourcesFromResourcesPage",
)(
    function* (page: Page): Effect.fn.Return<Resource[], LmsSourceGatewayError> {
        yield* verifyMaterialResources(page);
        const entries = yield* tryPromise(
            "read resource metadata",
            () =>
                page.locator('td[data-label="資料名"]').evaluateAll((cells) =>
                    cells.map((cell) => ({
                        name: cell.textContent ?? "",
                        kind: Array.from(cell.querySelectorAll("[title], img[alt]"))
                            .map((icon) => icon.getAttribute("title") ?? icon.getAttribute("alt"))
                            .find((label) => label?.endsWith("資料")) ?? "unknown",
                        handlers: Array.from(cell.querySelectorAll("a"))
                            .flatMap((link) => [link.getAttribute("onclick"), link.getAttribute("href")])
                            .filter((value): value is string => value !== null),
                    }))
                ),
        );
        const resources: Resource[] = [];
        const seen = new Set<string>();
        for (const entry of entries) {
            let id: string | undefined;
            let url: string | undefined;
            for (const handler of entry.handlers) {
                const file = /downloadFile\s*\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]*)['"]/.exec(handler);
                if (file !== null) id = file[1];
                const windowUrl = /openWindow\s*\(\s*(['"])(.*?)\1/.exec(handler)?.[2];
                const candidate = windowUrl ?? (handler.startsWith("javascript:") ? undefined : handler);
                if (candidate !== undefined) {
                    const parsed = yield* Effect.try({
                        try: () => new URL(candidate, page.url()),
                        catch: () =>
                            new LmsSourceGatewayError({
                                operation: "read resource metadata",
                                message: "Invalid resource link URL.",
                            }),
                    });
                    id ??= parsed.searchParams.get("syosaiId") ?? undefined;
                    url ??= parsed.searchParams.get("fileurl") ?? undefined;
                }
                // Unknown kinds can still expose the same detail ID in their handler.
                if (entry.kind !== "ファイル資料" && entry.kind !== "外部資料") {
                    id ??= /['"](SRS\d+)['"]/.exec(handler)?.[1];
                }
            }
            if (id === undefined || !/^SRS\d+$/.test(id) || seen.has(id)) {
                return yield* new LmsSourceGatewayError({
                    operation: "read LMS resource ID",
                    message: `A resource has a missing, invalid, or duplicate LMS detail ID: ${id ?? "missing"}`,
                });
            }
            seen.add(id);
            if (entry.kind === "外部資料") {
                if (url === undefined) {
                    return yield* new LmsSourceGatewayError({
                        operation: "read external resource URL",
                        message: "The external resource has no source URL.",
                    });
                }
                yield* Effect.try({
                    try: () => {
                        const parsed = new URL(url);
                        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                            throw new Error("Unsupported protocol");
                        }
                    },
                    catch: () =>
                        new LmsSourceGatewayError({
                            operation: "read external resource URL",
                            message: "The external resource URL must be HTTP(S).",
                        }),
                });
            }
            resources.push({
                name: normalizeText(entry.name),
                lmsResourceId: LmsResourceId(id),
                type: entry.kind === "ファイル資料" ? "file" : entry.kind === "外部資料" ? "external" : "unsupported",
                sourceKind: entry.kind,
                ...(url === undefined ? {} : { url }),
            });
        }
        return resources;
    },
);

/** Resolves IDs against the current page before using normal LMS click behavior. */
export const downloadResourceFromResourcesPage = Effect.fn("PlaywrightBrowser.downloadResourceFromResourcesPage")(
    function* (
        page: Page,
        selection: number | LmsResourceId,
    ): Effect.fn.Return<ResourceDownload, LmsSourceGatewayError> {
        yield* verifyMaterialResources(page);
        const resources = yield* readMaterialResourcesFromResourcesPage(page);
        const position = typeof selection === "number"
            ? selection
            : resources.findIndex((resource) => resource.lmsResourceId === selection);
        yield* Schema.decodeEffect(Schema.Natural)(position).pipe(
            Effect.mapError(() =>
                new LmsSourceGatewayError({
                    operation: "find resource",
                    message: "Resource position must be a nonnegative integer.",
                })
            ),
        );
        const cells = page.locator('td[data-label="資料名"]');
        if (position >= (yield* tryPromise("find resource", () => cells.count()))) {
            return yield* new LmsSourceGatewayError({
                operation: "find resource",
                message: `No resource at position ${position}.`,
            });
        }
        const cell = cells.nth(position);
        const kind = yield* tryPromise(
            "read resource kind",
            () =>
                cell.locator("[title], img[alt]").evaluateAll((icons) =>
                    icons.map((icon) => icon.getAttribute("title") ?? icon.getAttribute("alt")).find((label) =>
                        label?.endsWith("資料")
                    ) ?? null
                ),
        );
        if (kind !== "ファイル資料" && kind !== "外部資料") {
            return yield* new LmsSourceGatewayError({
                operation: "read resource kind",
                message: `Unsupported resource kind: ${kind ?? "unknown"}`,
            });
        }
        const link = cell.getByRole("link").first();
        if ((yield* tryPromise("find resource link", () => link.count())) === 0) {
            return yield* new LmsSourceGatewayError({
                operation: "find resource link",
                message: "The resource has no link.",
            });
        }
        if (kind === "ファイル資料") {
            const [download] = yield* Effect.all([
                tryPromise("download resource", () => page.waitForEvent("download")),
                tryPromise("click file resource", () => link.click()),
            ], { concurrency: "unbounded" });
            const directory = yield* tryPromise(
                "create resource directory",
                () => Deno.makeTempDir({ prefix: "ku-potato-" }),
            );
            const filename = Array.from(
                download.suggestedFilename(),
                (character) => character.charCodeAt(0) < 32 ? "_" : character,
            ).join("").replace(/[<>:"/\\|?*]/g, "_").replace(/[. ]+$/, "");
            // Prefixing also makes Windows device names safe (CON, NUL, etc.).
            const path = `${directory}/download-${filename || "resource"}`;
            yield* tryPromise("save resource", () => download.saveAs(path));
            yield* tryPromise("delete temporary download", () => download.delete());
            return { type: "file", path, originalFilename: download.suggestedFilename() };
        }
        const context = page.context();
        const origin = new URL(page.url()).origin;
        const sourceUrl = resources[position].url!;
        const targetUrl = new URL(sourceUrl);
        // Fragments belong to the archived source URL but never appear in HTTP requests.
        targetUrl.hash = "";
        const previousPages = new Set(context.pages());
        const capturedUrl = Effect.callback<string>((resume) => {
            const observe = (request: Request) => {
                if (
                    request.isNavigationRequest() &&
                    (request.url() === targetUrl.href || new URL(request.url()).origin !== origin)
                ) {
                    context.off("request", observe);
                    resume(Effect.succeed(sourceUrl));
                }
            };
            context.on("request", observe);
            return Effect.sync(() => {
                context.off("request", observe);
            });
        }).pipe(Effect.timeoutOrElse({
            duration: "30 seconds",
            orElse: () =>
                Effect.fail(
                    new LmsSourceGatewayError({
                        operation: "open external resource",
                        message: "External resource did not open an HTTP(S) URL.",
                    }),
                ),
        }));
        return yield* Effect.scoped(Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
                Effect.forEach(
                    context.pages().filter((popup) => !previousPages.has(popup)),
                    (popup) =>
                        tryPromise("close external resource", () => popup.close()).pipe(Effect.catch(Effect.logError)),
                    { discard: true },
                )
            );
            const [url] = yield* Effect.all([
                capturedUrl,
                tryPromise("wait for external resource tab", () => page.waitForEvent("popup")),
                tryPromise("click external resource", () => link.click()),
            ], { concurrency: "unbounded" });
            return { type: "external", url } as const;
        }));
    },
);
