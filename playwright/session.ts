import { Effect, Semaphore } from "effect";
import type { Page } from "playwright-core";
import { LmsMaterialNotFoundError, LmsSourceGatewayError, type LmsSourceSession } from "../core/out_port.ts";
import type {
    Course,
    CourseMaterialsSnapshot,
    LmsCourseId,
    LmsMaterialId,
    MaterialResourcesSnapshot,
} from "../domain/mod.ts";
import { openLmsHome, readCourses } from "./home.ts";
import { readCourseMaterials } from "./course.ts";
import { downloadResourceFromResourcesPage, readMaterialResourcesFromCoursePage } from "./resources.ts";

/** Serializes operations on one tab and reuses its course index within the session. */
export const makeLmsSourceSession = (page: Page): LmsSourceSession => {
    const semaphore = Semaphore.makeUnsafe(1);
    let courses: readonly Course[] | undefined;
    const fetchCourses = Effect.gen(function* () {
        yield* openLmsHome(page);
        courses = yield* readCourses(page);
        return courses;
    });
    const courseIndex = Effect.suspend(() => courses === undefined ? fetchCourses : Effect.succeed(courses));
    const openMaterialResources = Effect.fn("PlaywrightBrowser.openMaterialResources")(function* (
        lmsMaterialId: LmsMaterialId,
        preferredCourseId?: LmsCourseId,
    ) {
        const courses = yield* courseIndex;
        const courseIds = [
            ...new Set(
                courses.flatMap((course) => course.availability === "available" ? [course.lmsCourseId] : []),
            ),
        ];
        const orderedCourseIds = preferredCourseId === undefined ? courseIds : [
            ...courseIds.filter((id) => id === preferredCourseId),
            ...courseIds.filter((id) => id !== preferredCourseId),
        ];
        for (const lmsCourseId of orderedCourseIds) {
            yield* openLmsHome(page);
            const courseMaterials = yield* readCourseMaterials(page, lmsCourseId).pipe(
                Effect.catchTag("LmsCourseNotFoundError", () => Effect.void),
            );
            if (courseMaterials === undefined) continue;
            const material = courseMaterials.folders
                .flatMap((folder) => folder.materials)
                .find((material) => material.lmsMaterialId === lmsMaterialId);
            if (material === undefined) continue;
            const resources = material.type === "material" && material.resourceAvailability === "available"
                ? yield* readMaterialResourcesFromCoursePage(page, lmsMaterialId)
                : [];
            return {
                courses,
                courseMaterials,
                materialResources: { lmsMaterialId, resources },
            } satisfies MaterialResourcesSnapshot;
        }
        return yield* new LmsMaterialNotFoundError({
            lmsMaterialId,
            message: `Cannot find the material in any available course: ${lmsMaterialId}`,
        });
    });
    return {
        fetchCourses: semaphore.withPermits(1)(fetchCourses),
        fetchCourseMaterials: (lmsCourseId) =>
            semaphore.withPermits(1)(Effect.gen(function* () {
                yield* openLmsHome(page);
                const courses = yield* courseIndex;
                const courseMaterials = yield* readCourseMaterials(page, lmsCourseId);
                return { courses, courseMaterials } satisfies CourseMaterialsSnapshot;
            })),
        fetchMaterialResources: (lmsMaterialId, preferredCourseId) =>
            semaphore.withPermits(1)(openMaterialResources(lmsMaterialId, preferredCourseId)),
        downloadResource: (lmsMaterialId, selection, preferredCourseId) =>
            semaphore.withPermits(1)(Effect.gen(function* () {
                const snapshot = yield* openMaterialResources(lmsMaterialId, preferredCourseId);
                const position = typeof selection === "number"
                    ? selection
                    : snapshot.materialResources.resources.findIndex((resource) =>
                        resource.lmsResourceId === selection
                    );
                const download = yield* Effect.result(
                    position < 0 || position >= snapshot.materialResources.resources.length
                        ? Effect.fail(
                            new LmsSourceGatewayError({
                                operation: "find resource",
                                message: `Cannot find resource at position ${position} in material ${lmsMaterialId}.`,
                            }),
                        )
                        : downloadResourceFromResourcesPage(page, selection),
                );
                return { snapshot, download };
            })),
    };
};
