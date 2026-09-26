import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { LmsCacheGateway, LmsCacheGatewayError, LmsCacheMissError } from "ku-potato-core/out_port";
import {
    type CourseMaterialsSnapshot,
    LmsCourseId,
    LmsMaterialId,
    type MaterialResourcesSnapshot,
} from "ku-potato-domain";
import { DateTime, Effect, Result } from "effect";
import { makeLazyLmsCacheGateway, makeLmsCacheGateway, makeLmsCacheGatewayLayer } from "./mod.ts";

Deno.test("lazy SQLite cache does not open the database until it is used", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    const databasePath = temporaryDatabasePath(directory);

    try {
        const existsBeforeUse = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            yield* makeLazyLmsCacheGateway(databasePath);
            return yield* fileExists(databasePath);
        })));

        assertEquals(existsBeforeUse, false);
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("SQLite Layer opens the database only for a cache operation and closes it with the scope", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    const databasePath = temporaryDatabasePath(directory);

    try {
        const result = await Effect.runPromise(
            Effect.gen(function* () {
                const cache = yield* LmsCacheGateway;
                const beforeUse = yield* fileExists(databasePath);
                const firstRead = yield* Effect.result(cache.listCourses);
                const afterUse = yield* fileExists(databasePath);
                return { beforeUse, firstRead, afterUse };
            }).pipe(Effect.provide(makeLmsCacheGatewayLayer(databasePath))),
        );

        assertEquals(result.beforeUse, false);
        assert(Result.isFailure(result.firstRead));
        assertInstanceOf(result.firstRead.failure, LmsCacheMissError);
        assertEquals(result.afterUse, true);
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("SQLite cache keeps material resources after a later course material snapshot", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    const databasePath = temporaryDatabasePath(directory);
    const courseId = LmsCourseId("course-1");
    const materialId = LmsMaterialId("material-1");
    const course = { lmsCourseId: courseId, name: "Programming", availability: "available" } as const;
    const courseMaterials: CourseMaterialsSnapshot = {
        courses: [course],
        courseMaterials: {
            lmsCourseId: courseId,
            folders: [{
                name: "Week 1",
                classDate: DateTime.toDate(DateTime.makeUnsafe("2026-04-01T00:00:00.000Z")),
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
    const materialResources: MaterialResourcesSnapshot = {
        ...courseMaterials,
        materialResources: {
            lmsMaterialId: materialId,
            resources: [{ name: "week-1.pdf" }],
        },
    };
    const laterCourseMaterials: CourseMaterialsSnapshot = {
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
                resources: yield* cache.listMaterialResources(materialId),
                detail: yield* cache.getMaterialDetail(materialId),
            };
        })));

        assertEquals(result.courses, [course]);
        assertEquals(result.materials, laterCourseMaterials.courseMaterials);
        assertEquals(result.resources, materialResources.materialResources);
        assertEquals(result.detail, {
            course,
            material: courseMaterials.courseMaterials.folders[0]?.materials[0],
            resources: materialResources.materialResources.resources,
        });
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("SQLite cache rolls back every failed snapshot write", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    const courseId = LmsCourseId("course-1");
    const materialId = LmsMaterialId("material-1");
    const course = { lmsCourseId: courseId, name: "Original course", availability: "available" } as const;
    const material = {
        lmsMaterialId: materialId,
        name: "Original material",
        type: "material",
        publicationDeadline: "no-deadline",
        resourceAvailability: "available",
    } as const;
    const original: MaterialResourcesSnapshot = {
        courses: [course],
        courseMaterials: {
            lmsCourseId: courseId,
            folders: [{ name: "Original folder", materials: [material] }],
        },
        materialResources: { lmsMaterialId: materialId, resources: [{ name: "original.pdf" }] },
    };
    const changedCourse = { ...course, name: "Changed course" };
    const changedMaterials = {
        lmsCourseId: courseId,
        folders: [{ name: "Changed folder", materials: [{ ...material, name: "Changed material" }] }],
    };

    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const cache = yield* makeLmsCacheGateway(temporaryDatabasePath(directory));
            yield* cache.appendMaterialResources(original);

            const badCourses = yield* Effect.result(cache.appendCourses([
                changedCourse,
                { ...course, name: null as unknown as string },
            ]));
            assert(Result.isFailure(badCourses));
            assertInstanceOf(badCourses.failure, LmsCacheGatewayError);
            assertEquals(yield* cache.listCourses, original.courses);

            const badMaterials = yield* Effect.result(cache.appendCourseMaterials({
                courses: [changedCourse],
                courseMaterials: {
                    lmsCourseId: courseId,
                    folders: [{ name: "Changed folder", materials: [material, material] }],
                },
            }));
            assert(Result.isFailure(badMaterials));
            assertInstanceOf(badMaterials.failure, LmsCacheGatewayError);
            assertEquals(yield* cache.listCourses, original.courses);
            assertEquals(yield* cache.listCourseMaterials(courseId), original.courseMaterials);

            const badResources = yield* Effect.result(cache.appendMaterialResources({
                courses: [changedCourse],
                courseMaterials: changedMaterials,
                materialResources: {
                    lmsMaterialId: materialId,
                    resources: [{ name: null as unknown as string }],
                },
            }));
            assert(Result.isFailure(badResources));
            assertInstanceOf(badResources.failure, LmsCacheGatewayError);
            assertEquals(yield* cache.listCourses, original.courses);
            assertEquals(yield* cache.listCourseMaterials(courseId), original.courseMaterials);
            assertEquals(yield* cache.listMaterialResources(materialId), original.materialResources);
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

const temporaryDatabasePath = (directory: string): string =>
    `${directory}${directory.includes("\\") ? "\\" : "/"}cache.sqlite3`;

const fileExists = (path: string): Effect.Effect<boolean> =>
    Effect.promise(async () => {
        try {
            await Deno.stat(path);
            return true;
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) return false;
            throw error;
        }
    });

Deno.test("SQLite cache describes an unseeded value as a cache miss", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    try {
        const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const cache = yield* makeLmsCacheGateway(temporaryDatabasePath(directory));
            return yield* Effect.result(cache.listCourses);
        })));
        assert(Result.isFailure(result));
        assertInstanceOf(result.failure, LmsCacheMissError);
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});
