import { DateTime, Effect } from "effect";
import type { Locator } from "playwright-core";
import { LmsSourceGatewayError } from "../core/out_port.ts";
import { LmsMaterialId, type Material } from "../domain/mod.ts";
import { errorMessage, tryPromise } from "./promise.ts";

export function parseMaterialType(title: string | null): Effect.Effect<Material["type"], LmsSourceGatewayError> {
    switch (title) {
        case "Materials":
        case "資料":
            return Effect.succeed("material");
        case "e-Learning":
        case "e-learning":
            return Effect.succeed("e-learning");
        case "Report":
        case "レポート":
            return Effect.succeed("report");
        case "Test":
        case "テスト":
            return Effect.succeed("test");
        case "Questionnaire":
        case "アンケート":
            return Effect.succeed("questionnaire");
        default:
            return Effect.fail(
                new LmsSourceGatewayError({
                    operation: "parse material type",
                    message: `Unsupported material type: ${title}`,
                }),
            );
    }
}

export function parseLmsMaterialId(value: string | null): Effect.Effect<LmsMaterialId, LmsSourceGatewayError> {
    if (value !== null && /^[A-Z]+\d+$/.test(value)) return Effect.succeed(LmsMaterialId(value));
    return Effect.fail(
        new LmsSourceGatewayError({
            operation: "parse LMS material ID",
            message: `Cannot extract the LMS material ID from the material cell: ${value}`,
        }),
    );
}

export function parsePublicationDeadline(
    text: string | undefined,
): Effect.Effect<Material["publicationDeadline"], LmsSourceGatewayError> {
    if (text === "公開終了" || text === "Unavailable") return Effect.succeed("unavailable");
    return parseLmsDate(text).pipe(Effect.map((date) => date ?? "no-deadline"));
}

/** Parses an LMS date as Japan Standard Time. A date-only value means midnight JST. */
export function parseLmsDate(text: string | undefined): Effect.Effect<Date | undefined, LmsSourceGatewayError> {
    if (text === undefined) return Effect.succeed(undefined satisfies Date | undefined);
    const iso = text.replaceAll("/", "-").replace(" ", "T");
    return Effect.try({
        try: () => DateTime.toDate(DateTime.makeUnsafe(`${iso.includes("T") ? iso : `${iso}T00:00:00`}+09:00`)),
        catch: (cause) => new LmsSourceGatewayError({ operation: "parse LMS date", message: errorMessage(cause) }),
    });
}

export const readOptionalText = Effect.fn("PlaywrightBrowser.readOptionalText")(function* (
    locator: Locator,
): Effect.fn.Return<string | undefined, LmsSourceGatewayError> {
    const text = normalizeText((yield* tryPromise("read optional text", () => locator.textContent())) ?? "");
    return text === "" || /^[-‐‑‒–—―－]+$/.test(text) ? undefined : text;
});

export function normalizeText(text: string) {
    return text.replace(/\s+/g, " ").trim();
}
