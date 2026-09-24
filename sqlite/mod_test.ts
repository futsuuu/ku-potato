import { assertEquals, assertInstanceOf } from "@std/assert";
import { LmsCacheMissError } from "ku-potato-core/out_port";
import {
    type CourseMaterialsRefresh,
    LmsCourseId,
    LmsMaterialId,
    type MaterialResourcesRefresh,
} from "ku-potato-domain";
import { Effect } from "effect";
import { join } from "node:path";
import { makeLmsCacheGateway } from "./mod.ts";

Deno.test("SQLite cache keeps material resources after a later course material snapshot", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    const databasePath = join(directory, "cache.sqlite3");
    const courseId = LmsCourseId("course-1");
    const materialId = LmsMaterialId("material-1");
    const course = { lmsCourseId: courseId, name: "Programming", availability: "available" } as const;
    const courseMaterials: CourseMaterialsRefresh = {
        courses: [course],
        courseMaterials: {
            lmsCourseId: courseId,
            folders: [{
                name: "Week 1",
                classDate: new Date("2026-04-01T00:00:00.000Z"),
                materials: [{
                    lmsMaterialId: materialId,
                    name: "Handout",
                    type: "material",
                    publicationDeadline: "no-deadline",
                    resourceAvailability: "available",
                }],
            }],
        },
    };
    const materialResources: MaterialResourcesRefresh = {
        ...courseMaterials,
        materialResources: {
            lmsCourseId: courseId,
            lmsMaterialId: materialId,
            resources: [{ name: "week-1.pdf" }],
        },
    };
    const laterCourseMaterials: CourseMaterialsRefresh = {
        courses: [course],
        courseMaterials: {
            lmsCourseId: courseId,
            folders: [{ name: "Week 2", materials: [] }],
        },
    };

    try {
        const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const cache = yield* makeLmsCacheGateway(databasePath);
            yield* cache.appendCourses([course]);
            yield* cache.appendCourseMaterials(courseMaterials);
            yield* cache.appendMaterialResources(materialResources);
            yield* cache.appendCourseMaterials(laterCourseMaterials);
            return {
                courses: yield* cache.listCourses,
                materials: yield* cache.listCourseMaterials(courseId),
                resources: yield* cache.listMaterialResources(courseId, materialId),
            };
        })));

        assertEquals(result.courses, [course]);
        assertEquals(result.materials, laterCourseMaterials.courseMaterials);
        assertEquals(result.resources, materialResources.materialResources);
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("SQLite cache describes an unseeded value as a cache miss", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    try {
        const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const cache = yield* makeLmsCacheGateway(join(directory, "cache.sqlite3"));
            return yield* Effect.result(cache.listCourses);
        })));
        assertEquals(result._tag, "Failure");
        if (result._tag === "Failure") {
            assertInstanceOf(result.failure, LmsCacheMissError);
        }
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});
