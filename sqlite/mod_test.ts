import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { LmsArchiveDataMissingError, LmsArchiveGateway, LmsArchiveGatewayError } from "../core/out_port.ts";
import {
    type CourseMaterialsSnapshot,
    LmsCourseId,
    LmsMaterialId,
    LmsResourceId,
    type MaterialResourcesSnapshot,
    type Resource,
    type SavedResourceFile,
} from "../domain/mod.ts";
import { DateTime, Effect, Result } from "effect";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { fileURLToPath } from "node:url";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Construct fixture paths synchronously for bundled SQLite migrations.
import { join } from "node:path";
import { makeLazyLmsArchiveGateway, makeLmsArchiveGateway, makeLmsArchiveGatewayLayer } from "./mod.ts";

Deno.test("lazy SQLite archive does not open the database until it is used", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    const databasePath = temporaryDatabasePath(directory);

    try {
        const existsBeforeUse = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            yield* makeLazyLmsArchiveGateway(databasePath);
            return yield* fileExists(databasePath);
        })));

        assertEquals(existsBeforeUse, false);
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("SQLite Layer opens the database only for an archive operation and closes it with the scope", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    const databasePath = temporaryDatabasePath(directory);

    try {
        const result = await Effect.runPromise(
            Effect.gen(function* () {
                const archive = yield* LmsArchiveGateway;
                const beforeUse = yield* fileExists(databasePath);
                const firstRead = yield* Effect.result(archive.listCourses);
                const afterUse = yield* fileExists(databasePath);
                return { beforeUse, firstRead, afterUse };
            }).pipe(Effect.provide(makeLmsArchiveGatewayLayer(databasePath))),
        );

        assertEquals(result.beforeUse, false);
        assert(Result.isFailure(result.firstRead));
        assertInstanceOf(result.firstRead.failure, LmsArchiveDataMissingError);
        assertEquals(result.afterUse, true);
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("SQLite archive keeps material resources after a later course material snapshot", async () => {
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
            const archive = yield* makeLmsArchiveGateway(databasePath);
            assertEquals(yield* archive.findMaterialCourseId(materialId), undefined);
            yield* archive.appendCourses([course]);
            yield* archive.appendCourseMaterials(courseMaterials);
            assertEquals(yield* archive.findMaterialCourseId(materialId), courseId);
            const missingResources = yield* Effect.result(archive.getMaterialDetail(materialId));
            assert(Result.isFailure(missingResources));
            assertInstanceOf(missingResources.failure, LmsArchiveDataMissingError);
            yield* archive.appendMaterialResources(materialResources);
            yield* archive.appendCourseMaterials(laterCourseMaterials);
            return {
                courses: yield* archive.listCourses,
                materials: yield* archive.listCourseMaterials(courseId),
                resources: yield* archive.listMaterialResources(materialId),
                detail: yield* archive.getMaterialDetail(materialId),
            };
        })));

        assertEquals(result.courses, [course]);
        assertEquals(result.materials, laterCourseMaterials.courseMaterials);
        assertEquals(result.resources, materialResources.materialResources);
        assertEquals(result.detail, {
            course,
            material: {
                ...courseMaterials.courseMaterials.folders[0]?.materials[0],
                type: "material",
                archived: true,
                resourceAvailability: "unavailable",
            },
            resources: materialResources.materialResources.resources,
        });
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test.each([
    { resources: [] },
    { resources: [{ name: "handout.pdf" }] },
])("SQLite archive retains $resources.length resources after a material becomes unavailable", async ({ resources }) => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    const course = {
        lmsCourseId: LmsCourseId("course-1"),
        name: "Programming",
        availability: "available",
    } as const;
    const material = {
        lmsMaterialId: LmsMaterialId("material-1"),
        name: "Handout",
        type: "material",
        publicationDeadline: "no-deadline",
        resourceAvailability: "available",
    } as const;
    const expiredMaterial = {
        ...material,
        publicationDeadline: "unavailable",
        resourceAvailability: "unavailable",
    } as const;
    const expiredSnapshot: CourseMaterialsSnapshot = {
        courses: [course],
        courseMaterials: {
            lmsCourseId: course.lmsCourseId,
            folders: [{ name: "Week 1", materials: [expiredMaterial] }],
        },
    };

    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const archive = yield* makeLmsArchiveGateway(temporaryDatabasePath(directory));
            yield* archive.appendCourseMaterials(expiredSnapshot);
            const missingResources = yield* Effect.result(archive.getMaterialDetail(material.lmsMaterialId));
            assert(Result.isFailure(missingResources));
            assertInstanceOf(missingResources.failure, LmsArchiveDataMissingError);

            yield* archive.appendMaterialResources({
                courses: [course],
                courseMaterials: {
                    lmsCourseId: course.lmsCourseId,
                    folders: [{ name: "Week 1", materials: [material] }],
                },
                materialResources: { lmsMaterialId: material.lmsMaterialId, resources },
            });
            yield* archive.appendCourseMaterials(expiredSnapshot);
            assertEquals(yield* archive.getMaterialDetail(material.lmsMaterialId), {
                course,
                material: expiredMaterial,
                resources,
            });
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("SQLite archive rolls back every failed snapshot write", async () => {
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
            const archive = yield* makeLmsArchiveGateway(temporaryDatabasePath(directory));
            yield* archive.appendMaterialResources(original);

            const badCourses = yield* Effect.result(archive.appendCourses([
                changedCourse,
                { ...course, name: null as unknown as string },
            ]));
            assert(Result.isFailure(badCourses));
            assertInstanceOf(badCourses.failure, LmsArchiveGatewayError);
            assertEquals(yield* archive.listCourses, original.courses);

            const badMaterials = yield* Effect.result(archive.appendCourseMaterials({
                courses: [changedCourse],
                courseMaterials: {
                    lmsCourseId: courseId,
                    folders: [{ name: "Changed folder", materials: [material, material] }],
                },
            }));
            assert(Result.isFailure(badMaterials));
            assertInstanceOf(badMaterials.failure, LmsArchiveGatewayError);
            assertEquals(yield* archive.listCourses, original.courses);
            assertEquals(yield* archive.listCourseMaterials(courseId), original.courseMaterials);

            const badResources = yield* Effect.result(archive.appendMaterialResources({
                courses: [changedCourse],
                courseMaterials: changedMaterials,
                materialResources: {
                    lmsMaterialId: materialId,
                    resources: [{ name: null as unknown as string }],
                },
            }));
            assert(Result.isFailure(badResources));
            assertInstanceOf(badResources.failure, LmsArchiveGatewayError);
            assertEquals(yield* archive.listCourses, original.courses);
            assertEquals(yield* archive.listCourseMaterials(courseId), original.courseMaterials);
            assertEquals(yield* archive.listMaterialResources(materialId), original.materialResources);
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

const temporaryDatabasePath = (directory: string): string =>
    `${directory}${directory.includes("\\") ? "\\" : "/"}lms-archive.sqlite3`;

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

Deno.test("SQLite archive reports missing data for an unseeded value", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    try {
        const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const archive = yield* makeLmsArchiveGateway(temporaryDatabasePath(directory));
            return yield* Effect.result(archive.listCourses);
        })));
        assert(Result.isFailure(result));
        assertInstanceOf(result.failure, LmsArchiveDataMissingError);
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

const resourceId = LmsResourceId("SRS0000000000001");
const archiveMaterialId = LmsMaterialId("material-1");
const savedFile: SavedResourceFile = {
    uuid: "0f859f3d-91a4-4321-bcc0-2c4d1b07e03f",
    originalFilename: "handout.pdf",
    sha256: "1234567890abcdef",
    size: 42,
    sourceUrl: "https://example.com/old.pdf",
};

const resourceSnapshot = (resources: readonly Resource[]): MaterialResourcesSnapshot => ({
    courses: [{ lmsCourseId: LmsCourseId("course-1"), name: "Programming", availability: "available" }],
    courseMaterials: {
        lmsCourseId: LmsCourseId("course-1"),
        folders: [{
            name: "Week 1",
            materials: [{
                lmsMaterialId: archiveMaterialId,
                name: "Handout",
                type: "material",
                publicationDeadline: "no-deadline",
                resourceAvailability: "available",
            }],
        }],
    },
    materialResources: { lmsMaterialId: archiveMaterialId, resources },
});

Deno.test("SQLite keeps saved files and original source URLs through failures and removal", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    const succeededAt = DateTime.toDate(DateTime.makeUnsafe("2026-04-01T00:00:00Z"));
    const failedAt = DateTime.toDate(DateTime.makeUnsafe("2026-04-02T00:00:00Z"));
    const updated = {
        name: "Updated slides",
        lmsResourceId: resourceId,
        type: "external",
        sourceKind: "外部資料",
        url: "https://example.com/new.pdf",
    } as const;
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const archive = yield* makeLmsArchiveGateway(temporaryDatabasePath(directory));
            yield* archive.appendMaterialResources(resourceSnapshot([{
                ...updated,
                url: savedFile.sourceUrl,
                name: "Original slides",
            }]));
            assertEquals(
                yield* archive.commitResourceAcquisition(archiveMaterialId, resourceId, savedFile, succeededAt),
                undefined,
            );
            yield* archive.appendMaterialResources(resourceSnapshot([updated]));
            yield* archive.recordResourceAttempt(archiveMaterialId, resourceId, {
                at: failedAt,
                status: "failure",
                error: "Unavailable",
            });
            const current = {
                ...updated,
                availability: "current",
                savedFile,
                acquisition: {
                    lastSucceededAt: succeededAt,
                    lastAttempt: { at: failedAt, status: "failure", error: "Unavailable" },
                },
            } as const;
            assertEquals(yield* archive.getResourceState(archiveMaterialId, resourceId), current);
            yield* archive.appendMaterialResources(resourceSnapshot([]));
            assertEquals((yield* archive.listMaterialResources(archiveMaterialId)).resources, [{
                ...current,
                availability: "archived",
            }]);
            const replacement = { ...savedFile, uuid: "52c66c38-e14e-458e-b62f-026293d15fe8" };
            assertEquals(
                yield* archive.commitResourceAcquisition(archiveMaterialId, resourceId, replacement, failedAt),
                savedFile,
            );
            assertEquals((yield* archive.getResourceState(archiveMaterialId, resourceId))?.savedFile, replacement);
            // A URL acquisition succeeds without removing a previously saved file.
            assertEquals(
                yield* archive.commitResourceAcquisition(archiveMaterialId, resourceId, undefined, failedAt),
                replacement,
            );
            assertEquals((yield* archive.getResourceState(archiveMaterialId, resourceId))?.savedFile, replacement);
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("SQLite preserves external URLs on listing without requiring acquisition and retains unsupported kinds", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    const external = {
        name: "Slides",
        lmsResourceId: resourceId,
        type: "external",
        url: "https://example.com/slides",
    } as const;
    const unsupported = {
        name: "Unknown",
        lmsResourceId: LmsResourceId("SRS0000000000002"),
        type: "unsupported",
        sourceKind: "未対応資料",
    } as const;
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const archive = yield* makeLmsArchiveGateway(temporaryDatabasePath(directory));
            yield* archive.appendMaterialResources(resourceSnapshot([external, unsupported]));
            assertEquals((yield* archive.listMaterialResources(archiveMaterialId)).resources, [
                { ...external, availability: "current" },
                { ...unsupported, availability: "current" },
            ]);
            yield* archive.appendMaterialResources(resourceSnapshot([]));
            assertEquals((yield* archive.listMaterialResources(archiveMaterialId)).resources, [{
                ...external,
                availability: "archived",
            }]);
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("SQLite rolls back duplicate resource IDs and failed file metadata switches", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    const path = temporaryDatabasePath(directory);
    const resource = { name: "Handout", lmsResourceId: resourceId, type: "file" } as const;
    const at = DateTime.toDate(DateTime.makeUnsafe("2026-04-01T00:00:00Z"));
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const archive = yield* makeLmsArchiveGateway(path);
            yield* archive.appendMaterialResources(resourceSnapshot([resource]));
            yield* archive.commitResourceAcquisition(archiveMaterialId, resourceId, savedFile, at);
            const previous = yield* archive.getResourceState(archiveMaterialId, resourceId);
            const duplicate = yield* Effect.result(archive.appendMaterialResources(resourceSnapshot([
                { ...resource, name: "Changed" },
                resource,
            ])));
            assert(Result.isFailure(duplicate));
            assertEquals(yield* archive.getResourceState(archiveMaterialId, resourceId), previous);
            const connection = drizzle(path);
            try {
                connection.$client.exec(
                    "CREATE TRIGGER reject_file_update BEFORE UPDATE OF file_uuid ON resource_states BEGIN SELECT RAISE(ABORT, 'Rejected file update'); END",
                );
                const failure = yield* Effect.result(
                    archive.commitResourceAcquisition(
                        archiveMaterialId,
                        resourceId,
                        { ...savedFile, uuid: "new-uuid" },
                        DateTime.toDate(DateTime.nowUnsafe()),
                    ),
                );
                assert(Result.isFailure(failure));
                assertEquals(yield* archive.getResourceState(archiveMaterialId, resourceId), previous);
            } finally {
                connection.$client.close();
            }
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("SQLite migrates populated legacy resource snapshots without inventing IDs", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-migration-" });
    const path = temporaryDatabasePath(directory);
    const migrationDirectory = join(directory, "old-migrations");
    await Deno.mkdir(migrationDirectory);
    const bundled = fileURLToPath(new URL("./drizzle", import.meta.url));
    try {
        for await (const entry of Deno.readDir(bundled)) {
            if (!entry.isDirectory || entry.name >= "20261007204530") continue;
            const destination = join(migrationDirectory, entry.name);
            await Deno.mkdir(destination);
            await Deno.copyFile(join(bundled, entry.name, "migration.sql"), join(destination, "migration.sql"));
            await Deno.copyFile(join(bundled, entry.name, "snapshot.json"), join(destination, "snapshot.json"));
        }
        const legacy = drizzle(path);
        try {
            legacy.$client.exec("PRAGMA foreign_keys=OFF");
            migrate(legacy, { migrationsFolder: migrationDirectory });
            legacy.$client.exec(`
                INSERT INTO course_retrievals(id,fetched_at) VALUES(1,0);
                INSERT INTO courses(retrieval_id,position,lms_course_id,name,availability) VALUES(1,0,'course-1','Programming','available');
                INSERT INTO course_material_retrievals(id,course_retrieval_id,course_position,lms_course_id,fetched_at) VALUES(1,1,0,'course-1',0);
                INSERT INTO course_material_folders(retrieval_id,position,name) VALUES(1,0,'Week 1');
                INSERT INTO course_materials(retrieval_id,position,lms_material_id,folder_position,name,type,publication_deadline_status,resource_availability) VALUES(1,0,'material-1',0,'Handout','material','no-deadline','available');
                INSERT INTO material_resource_retrievals(id,lms_material_id,fetched_at) VALUES(1,'material-1',0);
                INSERT INTO material_resources(retrieval_id,position,name) VALUES(1,0,'legacy.pdf');
            `);
        } finally {
            legacy.$client.close();
        }
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const archive = yield* makeLmsArchiveGateway(path);
            const detail = yield* archive.getMaterialDetail(archiveMaterialId);
            assertEquals(detail.resources, [{ name: "legacy.pdf" }]);
            assertEquals(detail.material.name, "Handout");
            assertEquals(detail.course.name, "Programming");
            assertEquals(yield* archive.getResourceState(archiveMaterialId, resourceId), undefined);
            yield* archive.appendMaterialResources(
                resourceSnapshot([{ name: "legacy.pdf", lmsResourceId: resourceId, type: "file" }]),
            );
            assertEquals((yield* archive.getMaterialDetail(archiveMaterialId)).resources, [{
                name: "legacy.pdf",
                lmsResourceId: resourceId,
                type: "file",
                availability: "current",
            }]);
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("SQLite keeps archive navigation when saved materials and their course disappear", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-sqlite-" });
    const fileMaterial = resourceSnapshot([]).courseMaterials.folders[0]!.materials[0]!;
    const urlMaterial = { ...fileMaterial, lmsMaterialId: LmsMaterialId("material-2"), name: "Slides" };
    const unsavedMaterial = { ...fileMaterial, lmsMaterialId: LmsMaterialId("material-3"), name: "Not downloaded" };
    const fullCourse = {
        ...resourceSnapshot([]).courseMaterials,
        folders: [{ name: "Week 1", materials: [fileMaterial, urlMaterial, unsavedMaterial] }],
    };
    const snapshot = (id: LmsMaterialId, resource: Resource): MaterialResourcesSnapshot => ({
        ...resourceSnapshot([]),
        courseMaterials: fullCourse,
        materialResources: { lmsMaterialId: id, resources: [resource] },
    });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const archive = yield* makeLmsArchiveGateway(temporaryDatabasePath(directory));
            yield* archive.appendMaterialResources(
                snapshot(fileMaterial.lmsMaterialId, { name: "Handout", lmsResourceId: resourceId, type: "file" }),
            );
            yield* archive.commitResourceAcquisition(
                fileMaterial.lmsMaterialId,
                resourceId,
                savedFile,
                DateTime.toDate(DateTime.nowUnsafe()),
            );
            yield* archive.appendMaterialResources(
                snapshot(urlMaterial.lmsMaterialId, {
                    name: "Slides",
                    lmsResourceId: LmsResourceId("SRS0000000000002"),
                    type: "external",
                    url: "https://example.com/slides",
                }),
            );
            yield* archive.appendMaterialResources(
                snapshot(unsavedMaterial.lmsMaterialId, {
                    name: "Unsaved",
                    lmsResourceId: LmsResourceId("SRS0000000000003"),
                    type: "file",
                }),
            );
            // The course is still listed, but every material has disappeared from its current list.
            yield* archive.appendCourseMaterials({
                courses: resourceSnapshot([]).courses,
                courseMaterials: { ...fullCourse, folders: [{ name: "Week 2", materials: [] }] },
            });
            const archivedMaterials = [fileMaterial, urlMaterial].map((material) => ({
                ...material,
                archived: true,
                resourceAvailability: "unavailable",
            } as const));
            assertEquals((yield* archive.listCourseMaterials(fullCourse.lmsCourseId)).folders, [
                { name: "Week 2", materials: [] },
                { name: "Week 1", materials: archivedMaterials },
            ]);
            assertEquals((yield* archive.getMaterialDetail(fileMaterial.lmsMaterialId)).material, archivedMaterials[0]);
            assertEquals(
                (yield* archive.getMaterialDetail(fileMaterial.lmsMaterialId)).resources[0]?.availability,
                "archived",
            );
            // Removing HOME courses must keep only the hierarchy with saved content navigable.
            yield* archive.appendCourses([]);
            assertEquals(yield* archive.listCourses, [{ ...resourceSnapshot([]).courses[0], archived: true }]);
            assertEquals((yield* archive.listCourseMaterials(fullCourse.lmsCourseId)).folders, [{
                name: "Week 1",
                materials: archivedMaterials,
            }]);
            assertEquals((yield* archive.getMaterialDetail(fileMaterial.lmsMaterialId)).course.archived, true);
            // A course disappearing before its materials can be refreshed must also hide unsaved entries.
            yield* archive.appendCourseMaterials({
                courses: resourceSnapshot([]).courses,
                courseMaterials: fullCourse,
            });
            yield* archive.appendCourses([]);
            assertEquals((yield* archive.listCourseMaterials(fullCourse.lmsCourseId)).folders, [{
                name: "Week 1",
                materials: archivedMaterials,
            }]);
            // Reappearing content returns to the ordinary current view.
            yield* archive.appendCourseMaterials({
                courses: resourceSnapshot([]).courses,
                courseMaterials: fullCourse,
            });
            assertEquals((yield* archive.listCourseMaterials(fullCourse.lmsCourseId)).folders, fullCourse.folders);
            assertEquals((yield* archive.getMaterialDetail(fileMaterial.lmsMaterialId)).course.archived, undefined);
            assertEquals((yield* archive.getMaterialDetail(fileMaterial.lmsMaterialId)).material.archived, undefined);
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});
