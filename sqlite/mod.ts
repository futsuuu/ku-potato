/** SQLite implementation of the persistent LMS archive port. */

import {
    LmsArchiveDataMissingError,
    LmsArchiveGateway,
    LmsArchiveGatewayError,
    type LmsArchiveGatewayService,
} from "../core/out_port.ts";
import {
    type Course,
    type CourseMaterials,
    type CourseMaterialsSnapshot,
    LmsCourseId,
    LmsMaterialId,
    type Material,
    type MaterialDetail,
    type MaterialResources,
    type MaterialResourcesSnapshot,
} from "../domain/mod.ts";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { DateTime, Effect, Layer, Schema, Scope } from "effect";
import { fileURLToPath } from "node:url";
import { applicationDataPath } from "../platform/directories.ts";
import {
    courseMaterialFolders,
    courseMaterialRetrievals,
    courseMaterials,
    courseRetrievals,
    courses,
    materialResourceRetrievals,
    materialResources,
} from "./schema.ts";

export * from "./schema.ts";

type Database = ReturnType<typeof drizzle>;
type ArchiveConnection = Pick<Database, "insert" | "select">;
type CourseReadRow = Pick<typeof courses.$inferSelect, "lmsCourseId" | "name" | "availability">;
type MaterialReadRow = Pick<
    typeof courseMaterials.$inferSelect,
    | "folderPosition"
    | "lmsMaterialId"
    | "name"
    | "type"
    | "publicationDeadlineStatus"
    | "publicationDeadlineAt"
    | "resourceAvailability"
>;

/** The default user-local database location. */
export const defaultArchiveDatabasePath = (): string => applicationDataPath("lms-archive.sqlite3");

/**
 * Opens the archive database, applies bundled migrations, and exposes the archive
 * service for the lifetime of the surrounding Effect scope.
 */
export const makeLmsArchiveGateway = (
    databasePath = defaultArchiveDatabasePath(),
): Effect.Effect<LmsArchiveGatewayService, LmsArchiveGatewayError, Scope.Scope> =>
    Effect.acquireRelease(
        archiveWriteTry("open", () => {
            Deno.mkdirSync(databaseDirectory(databasePath), { recursive: true });
            const database = drizzle(databasePath);
            try {
                // Drizzle starts a transaction, inside which SQLite ignores foreign_keys changes.
                // Disable before migrating so table rebuilds cannot cascade-delete archived history.
                database.$client.exec("pragma foreign_keys = off");
                migrate(database, {
                    migrationsFolder: fileURLToPath(new URL("./drizzle", import.meta.url)),
                });
                database.$client.exec("pragma foreign_keys = on");
                if (database.$client.prepare("pragma foreign_key_check").all().length > 0) {
                    throw new Error("Archive migration left inconsistent foreign keys.");
                }
                return { database, gateway: LmsArchiveGateway.of(makeGateway(database)) };
            } catch (cause) {
                database.$client.close();
                throw cause;
            }
        }),
        ({ database }) =>
            Effect.sync(() => {
                database.$client.close();
            }),
    ).pipe(Effect.map(({ gateway }) => gateway));

/**
 * Creates an archive service that opens and migrates SQLite only when an archive
 * operation is first executed, then reuses it for the surrounding scope.
 */
export const makeLazyLmsArchiveGateway = (
    databasePath = defaultArchiveDatabasePath(),
): Effect.Effect<LmsArchiveGatewayService, never, Scope.Scope> =>
    Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const cachedGateway = yield* Effect.cached(
            makeLmsArchiveGateway(databasePath).pipe(Effect.provideService(Scope.Scope, scope)),
        );
        return LmsArchiveGateway.of({
            findMaterialCourseId: (lmsMaterialId) =>
                cachedGateway.pipe(Effect.flatMap((archive) => archive.findMaterialCourseId(lmsMaterialId))),
            listCourses: cachedGateway.pipe(Effect.flatMap((archive) => archive.listCourses)),
            listCourseMaterials: (lmsCourseId) =>
                cachedGateway.pipe(Effect.flatMap((archive) => archive.listCourseMaterials(lmsCourseId))),
            listMaterialResources: (lmsMaterialId) =>
                cachedGateway.pipe(Effect.flatMap((archive) => archive.listMaterialResources(lmsMaterialId))),
            getMaterialDetail: (lmsMaterialId) =>
                cachedGateway.pipe(Effect.flatMap((archive) => archive.getMaterialDetail(lmsMaterialId))),
            appendCourses: (courses) => cachedGateway.pipe(Effect.flatMap((archive) => archive.appendCourses(courses))),
            appendCourseMaterials: (snapshot) =>
                cachedGateway.pipe(Effect.flatMap((archive) => archive.appendCourseMaterials(snapshot))),
            appendMaterialResources: (snapshot) =>
                cachedGateway.pipe(Effect.flatMap((archive) => archive.appendMaterialResources(snapshot))),
        });
    });

/** A scoped archive service that retains lazy database initialization. */
export const makeLmsArchiveGatewayLayer = (databasePath = defaultArchiveDatabasePath()) =>
    Layer.effect(LmsArchiveGateway, makeLazyLmsArchiveGateway(databasePath));

const makeGateway = (database: Database): LmsArchiveGatewayService => ({
    findMaterialCourseId: (lmsMaterialId) =>
        archiveWriteTry("findMaterialCourseId", () => {
            const row = database.select({ lmsCourseId: courseMaterialRetrievals.lmsCourseId }).from(courseMaterials)
                .innerJoin(courseMaterialRetrievals, eq(courseMaterialRetrievals.id, courseMaterials.retrievalId))
                .where(eq(courseMaterials.lmsMaterialId, lmsMaterialId))
                .orderBy(desc(courseMaterials.retrievalId)).limit(1).get();
            return row === undefined ? undefined : LmsCourseId(row.lmsCourseId);
        }),
    listCourses: archiveReadTry("listCourses", () => readCourses(database)),
    listCourseMaterials: (lmsCourseId) =>
        archiveReadTry("listCourseMaterials", () => readCourseMaterials(database, lmsCourseId)),
    listMaterialResources: (lmsMaterialId) =>
        archiveReadTry("listMaterialResources", () => readMaterialResources(database, lmsMaterialId)),
    getMaterialDetail: (lmsMaterialId) =>
        archiveReadTry("getMaterialDetail", () => readMaterialDetail(database, lmsMaterialId)),
    appendCourses: (retrievedCourses) =>
        archiveWriteTry("appendCourses", () => recordCourses(database, retrievedCourses)),
    appendCourseMaterials: (snapshot) =>
        archiveWriteTry("appendCourseMaterials", () => recordCourseMaterials(database, snapshot)),
    appendMaterialResources: (snapshot) =>
        archiveWriteTry("appendMaterialResources", () => recordMaterialResources(database, snapshot)),
});

const archiveReadTry = <A>(
    operation: string,
    evaluate: () => A,
): Effect.Effect<A, LmsArchiveGatewayError | LmsArchiveDataMissingError> =>
    Effect.try({
        try: evaluate,
        catch: (cause) =>
            Schema.is(LmsArchiveDataMissingError)(cause)
                ? cause
                : new LmsArchiveGatewayError({ operation, message: describeCause(cause) }),
    });

const archiveWriteTry = <A>(operation: string, evaluate: () => A): Effect.Effect<A, LmsArchiveGatewayError> =>
    Effect.try({
        try: evaluate,
        catch: (cause) => new LmsArchiveGatewayError({ operation, message: describeCause(cause) }),
    });

const describeCause = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const recordCourses = (database: Database, retrievedCourses: readonly Course[]): void => {
    database.transaction((transaction) => {
        insertCourses(transaction, retrievedCourses);
    });
};

const recordCourseMaterials = (database: Database, snapshot: CourseMaterialsSnapshot): void => {
    database.transaction((transaction) => {
        const courseRetrievalId = insertCourses(transaction, snapshot.courses);
        const courseMaterialRetrievalId = insertCourseMaterialRetrieval(
            transaction,
            courseRetrievalId,
            snapshot.courseMaterials.lmsCourseId,
        );
        insertCourseMaterials(transaction, courseMaterialRetrievalId, snapshot.courseMaterials);
    });
};

const recordMaterialResources = (database: Database, snapshot: MaterialResourcesSnapshot): void => {
    database.transaction((transaction) => {
        const courseRetrievalId = insertCourses(transaction, snapshot.courses);
        const courseMaterialRetrievalId = insertCourseMaterialRetrieval(
            transaction,
            courseRetrievalId,
            snapshot.courseMaterials.lmsCourseId,
        );
        insertCourseMaterials(transaction, courseMaterialRetrievalId, snapshot.courseMaterials);

        const materialResourceRetrieval = transaction.insert(materialResourceRetrievals).values({
            lmsMaterialId: snapshot.materialResources.lmsMaterialId,
            fetchedAt: now(),
        }).returning({ id: materialResourceRetrievals.id }).get();
        if (materialResourceRetrieval == null) {
            throw new LmsArchiveGatewayError({
                operation: "appendMaterialResources",
                message: "Could not create retrieval.",
            });
        }
        const resourceRows = snapshot.materialResources.resources.map((resource, position) => ({
            retrievalId: materialResourceRetrieval.id,
            position,
            name: resource.name,
        }));
        if (resourceRows.length > 0) transaction.insert(materialResources).values(resourceRows).run();
    });
};

const insertCourses = (database: ArchiveConnection, retrievedCourses: readonly Course[]): number => {
    const retrieval = database.insert(courseRetrievals).values({ fetchedAt: now() })
        .returning({ id: courseRetrievals.id }).get();
    if (retrieval == null) {
        throw new LmsArchiveGatewayError({ operation: "appendCourses", message: "Could not create retrieval." });
    }
    const courseRows = retrievedCourses.map((course, position) => ({
        retrievalId: retrieval.id,
        position,
        lmsCourseId: course.availability === "available" ? course.lmsCourseId : null,
        name: course.name,
        availability: course.availability,
    }));
    if (courseRows.length > 0) database.insert(courses).values(courseRows).run();
    return retrieval.id;
};

const insertCourseMaterialRetrieval = (
    database: ArchiveConnection,
    courseRetrievalId: number,
    lmsCourseId: LmsCourseId,
): number => {
    const retrieval = database.insert(courseMaterialRetrievals).values({
        courseRetrievalId,
        coursePosition: findCoursePosition(database, courseRetrievalId, lmsCourseId),
        lmsCourseId,
        fetchedAt: now(),
    }).returning({ id: courseMaterialRetrievals.id }).get();
    if (retrieval == null) {
        throw new LmsArchiveGatewayError({
            operation: "appendCourseMaterials",
            message: "Could not create retrieval.",
        });
    }
    return retrieval.id;
};

const findCoursePosition = (database: ArchiveConnection, retrievalId: number, lmsCourseId: LmsCourseId): number => {
    const row = database.select({ position: courses.position }).from(courses)
        .where(and(eq(courses.retrievalId, retrievalId), eq(courses.lmsCourseId, lmsCourseId))).get();
    if (row === undefined) {
        throw new LmsArchiveGatewayError({
            operation: "appendCourseMaterials",
            message: `The course ${lmsCourseId} was absent from its bundled course retrieval.`,
        });
    }
    return row.position;
};

const insertCourseMaterials = (
    database: ArchiveConnection,
    retrievalId: number,
    retrievedMaterials: CourseMaterials,
): void => {
    const folderRows = retrievedMaterials.folders.map((folder, position) => ({
        retrievalId,
        position,
        name: folder.name,
        classDate: folder.classDate ?? null,
    }));
    if (folderRows.length > 0) database.insert(courseMaterialFolders).values(folderRows).run();

    const materialRows = retrievedMaterials.folders.flatMap((folder, folderPosition) =>
        folder.materials.map((material, materialIndex) => ({
            retrievalId,
            position: materialIndex + retrievedMaterials.folders
                .slice(0, folderPosition)
                .reduce((count, previousFolder) => count + previousFolder.materials.length, 0),
            lmsMaterialId: material.lmsMaterialId,
            folderPosition,
            name: material.name,
            type: material.type,
            ...encodePublicationDeadline(material.publicationDeadline),
            resourceAvailability: material.type === "material" ? material.resourceAvailability : null,
        }))
    );
    if (materialRows.length > 0) database.insert(courseMaterials).values(materialRows).run();
};

const readCourses = (database: Database): readonly Course[] => {
    const retrieval = database.select({ id: courseRetrievals.id })
        .from(courseRetrievals).orderBy(desc(courseRetrievals.id)).limit(1).get();
    if (retrieval == null) {
        throw archiveDataMissing("listCourses", "No course retrieval has been synchronized yet.");
    }
    return database.select({
        lmsCourseId: courses.lmsCourseId,
        name: courses.name,
        availability: courses.availability,
    }).from(courses).where(eq(courses.retrievalId, retrieval.id)).orderBy(asc(courses.position)).all()
        .map(decodeCourse);
};

const readCourseMaterials = (database: Database, lmsCourseId: string): CourseMaterials => {
    const retrieval = database.select({ id: courseMaterialRetrievals.id })
        .from(courseMaterialRetrievals)
        .where(eq(courseMaterialRetrievals.lmsCourseId, lmsCourseId))
        .orderBy(desc(courseMaterialRetrievals.id))
        .limit(1)
        .get();
    if (retrieval == null) {
        throw archiveDataMissing(
            "listCourseMaterials",
            `No material retrieval for course ${lmsCourseId} has been synchronized yet.`,
        );
    }
    const folders = database.select({
        position: courseMaterialFolders.position,
        name: courseMaterialFolders.name,
        classDate: courseMaterialFolders.classDate,
    })
        .from(courseMaterialFolders)
        .where(eq(courseMaterialFolders.retrievalId, retrieval.id))
        .orderBy(asc(courseMaterialFolders.position))
        .all();
    const materials = database.select({
        folderPosition: courseMaterials.folderPosition,
        lmsMaterialId: courseMaterials.lmsMaterialId,
        name: courseMaterials.name,
        type: courseMaterials.type,
        publicationDeadlineStatus: courseMaterials.publicationDeadlineStatus,
        publicationDeadlineAt: courseMaterials.publicationDeadlineAt,
        resourceAvailability: courseMaterials.resourceAvailability,
    })
        .from(courseMaterials)
        .where(eq(courseMaterials.retrievalId, retrieval.id))
        .orderBy(asc(courseMaterials.position))
        .all();
    const materialsByFolder = Map.groupBy(materials, (material) => material.folderPosition);

    return {
        lmsCourseId: LmsCourseId(lmsCourseId),
        folders: folders.map((folder) => ({
            name: folder.name,
            ...(folder.classDate === null ? {} : { classDate: folder.classDate }),
            materials: (materialsByFolder.get(folder.position) ?? []).map(decodeMaterial),
        })),
    };
};

const readMaterialResources = (database: Database, lmsMaterialId: string): MaterialResources => {
    const retrieval = database.select({ id: materialResourceRetrievals.id })
        .from(materialResourceRetrievals)
        .where(eq(materialResourceRetrievals.lmsMaterialId, lmsMaterialId))
        .orderBy(desc(materialResourceRetrievals.id))
        .limit(1)
        .get();
    if (retrieval == null) {
        throw archiveDataMissing(
            "listMaterialResources",
            `No resource retrieval for material ${lmsMaterialId} has been synchronized yet.`,
        );
    }
    const resources = database.select({ name: materialResources.name })
        .from(materialResources)
        .where(eq(materialResources.retrievalId, retrieval.id))
        .orderBy(asc(materialResources.position))
        .all();
    return {
        lmsMaterialId: LmsMaterialId(lmsMaterialId),
        resources: resources.map((resource) => ({ name: resource.name })),
    };
};

const readMaterialDetail = (database: Database, lmsMaterialId: string): MaterialDetail => {
    const row = database.select({
        courseLmsCourseId: courses.lmsCourseId,
        courseName: courses.name,
        courseAvailability: courses.availability,
        folderPosition: courseMaterials.folderPosition,
        lmsMaterialId: courseMaterials.lmsMaterialId,
        name: courseMaterials.name,
        type: courseMaterials.type,
        publicationDeadlineStatus: courseMaterials.publicationDeadlineStatus,
        publicationDeadlineAt: courseMaterials.publicationDeadlineAt,
        resourceAvailability: courseMaterials.resourceAvailability,
    })
        .from(courseMaterials)
        .innerJoin(courseMaterialRetrievals, eq(courseMaterialRetrievals.id, courseMaterials.retrievalId))
        .innerJoin(
            courses,
            and(
                eq(courses.retrievalId, courseMaterialRetrievals.courseRetrievalId),
                eq(courses.position, courseMaterialRetrievals.coursePosition),
                eq(courses.lmsCourseId, courseMaterialRetrievals.lmsCourseId),
            ),
        )
        .where(eq(courseMaterials.lmsMaterialId, lmsMaterialId))
        .orderBy(desc(courseMaterialRetrievals.id))
        .limit(1)
        .get();
    if (row == null) {
        throw archiveDataMissing("getMaterialDetail", `No material ${lmsMaterialId} has been synchronized yet.`);
    }
    if (row.courseAvailability !== "available" || row.courseLmsCourseId === null) {
        throw new LmsArchiveGatewayError({
            operation: "getMaterialDetail",
            message: `Material ${lmsMaterialId} belongs to an unavailable course.`,
        });
    }
    const material = decodeMaterial(row);
    const resources = material.type === "material" ? readMaterialResources(database, lmsMaterialId).resources : [];
    return {
        course: {
            lmsCourseId: LmsCourseId(row.courseLmsCourseId),
            name: row.courseName,
            availability: "available",
        },
        material,
        resources,
    };
};

const decodeCourse = (row: CourseReadRow): Course =>
    row.availability === "available" && row.lmsCourseId !== null
        ? { lmsCourseId: LmsCourseId(row.lmsCourseId), name: row.name, availability: "available" }
        : { name: row.name, availability: "unavailable" };

const decodeMaterial = (row: MaterialReadRow): Material => {
    const base = {
        lmsMaterialId: LmsMaterialId(row.lmsMaterialId),
        name: row.name,
        publicationDeadline: decodePublicationDeadline(row),
    };
    return row.type === "material"
        ? { ...base, type: "material", resourceAvailability: row.resourceAvailability ?? "unavailable" }
        : { ...base, type: row.type };
};

const encodePublicationDeadline = (value: Material["publicationDeadline"]): {
    readonly publicationDeadlineStatus: "scheduled" | "no-deadline" | "unavailable";
    readonly publicationDeadlineAt: Date | null;
} => value instanceof Date
    ? { publicationDeadlineStatus: "scheduled", publicationDeadlineAt: value }
    : { publicationDeadlineStatus: value, publicationDeadlineAt: null };

const decodePublicationDeadline = (
    row: MaterialReadRow,
): Material["publicationDeadline"] =>
    row.publicationDeadlineStatus === "scheduled"
        ? row.publicationDeadlineAt ?? DateTime.toDate(DateTime.makeUnsafe(0))
        : row.publicationDeadlineStatus;

const archiveDataMissing = (operation: string, message: string): LmsArchiveDataMissingError =>
    new LmsArchiveDataMissingError({ operation, message });

const now = (): Date => DateTime.toDate(DateTime.nowUnsafe());

const databaseDirectory = (databasePath: string): string => {
    const separatorIndex = Math.max(databasePath.lastIndexOf("/"), databasePath.lastIndexOf("\\"));
    if (separatorIndex === -1) return ".";
    return separatorIndex === 2 && databasePath[1] === ":"
        ? databasePath.slice(0, separatorIndex + 1)
        : databasePath.slice(0, separatorIndex);
};
