import { Effect } from "effect";
import type { Page } from "playwright-core";
import { LmsSourceGatewayError } from "../core/out_port.ts";
import { type Course, LmsCourseId } from "../domain/mod.ts";
import { tryPromise } from "./promise.ts";

/** Identifies HOME independently of the course cards being read or clicked. */
export const verifyLmsHome = Effect.fn("PlaywrightBrowser.verifyLmsHome")(function* (page: Page) {
    yield* tryPromise("verify KU-LMS home page", () => page.waitForURL(isLmsHomeUrl));
    yield* tryPromise(
        "verify KU-LMS course list heading",
        () => page.locator(".lms-search-condition-title").getByText("講義一覧", { exact: true }).waitFor(),
    );
    yield* tryPromise("verify KU-LMS course index", () => page.locator(".lms-weekly-area").waitFor());
});

/** Returns to HOME and verifies it even when the course index is already visible. */
export const openLmsHome = Effect.fn("PlaywrightBrowser.openLmsHome")(function* (
    page: Page,
): Effect.fn.Return<void, LmsSourceGatewayError> {
    const courseIndex = page.locator(".lms-weekly-area");
    if (!(yield* tryPromise("check course index", () => courseIndex.isVisible()))) {
        const homeLink = page.locator("a[href*='/lms/homeRedirect/']").first();
        const homeHref = yield* tryPromise("find KU-LMS home link", () => homeLink.getAttribute("href"));
        if (homeHref === null) {
            return yield* new LmsSourceGatewayError({
                operation: "open KU-LMS home",
                message: "The authenticated page does not provide a link to KU-LMS HOME.",
            });
        }
        yield* tryPromise("open KU-LMS home", () => page.goto(new URL(homeHref, page.url()).href));
    }
    yield* verifyLmsHome(page);
});

/** Reads courses only after HOME has been identified, including when the list is empty. */
export const readCourses = Effect.fn("PlaywrightBrowser.readCourses")(function* (
    page: Page,
): Effect.fn.Return<Course[], LmsSourceGatewayError> {
    yield* verifyLmsHome(page);
    const courseCards = page.locator(".lms-weekly-area .lms-cardname");

    const courses: Course[] = [];
    for (const courseCard of yield* tryPromise("find course cards", () => courseCards.all())) {
        const name = ((yield* tryPromise("read course name", () => courseCard.textContent())) ?? "")
            .replace(/\s+/g, " ").trim();
        const courseLink = courseCard.locator("a");
        if ((yield* tryPromise("find course link", () => courseLink.count())) === 0) {
            courses.push({ name, availability: "unavailable" });
            continue;
        }
        const lmsCourseId = yield* parseLmsCourseId(
            yield* tryPromise("read course click handler", () => courseLink.getAttribute("onclick")),
        );
        courses.push({ lmsCourseId, name, availability: "available" });
    }
    return courses;
});

export const isLmsHomeUrl = (url: URL): boolean =>
    url.protocol === "https:" && url.hostname === "study.ns.kogakuin.ac.jp" &&
    /^\/lms\/homeHoml\/doIndex(?:;|$)/.test(url.pathname);

/** Extracts the LMS course ID passed to the HOME page's course-opening form. */
export function parseLmsCourseId(onclick: string | null): Effect.Effect<LmsCourseId, LmsSourceGatewayError> {
    const match = onclick?.match(/\bformSubmit\(\s*["']([^"']+)["']/);
    if (match?.[1] !== undefined) return Effect.succeed(LmsCourseId(match[1]));
    return Effect.fail(
        new LmsSourceGatewayError({
            operation: "parse LMS course ID",
            message: `Cannot extract the LMS course ID from the course click handler: ${onclick}`,
        }),
    );
}
