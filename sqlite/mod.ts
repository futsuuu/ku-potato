/** SQLite implementation of the persistent LMS cache port. */

import {
    LmsCacheGateway,
    LmsCacheGatewayError,
    type LmsCacheGatewayService,
    LmsCacheMissError,
} from "ku-potato-core/out_port";
import {
    type Course,
    type CourseMaterial,
    type CourseMaterials,
    type CourseMaterialsRefresh,
    LmsCourseId,
    LmsMaterialId,
    type MaterialResources,
    type MaterialResourcesRefresh,
} from "ku-potato-domain";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { DateTime, Effect, Schema, Scope } from "effect";
import { fileURLToPath } from "node:url";
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
type CourseReadRow = Pick<typeof courses.$inferSelect, "lmsCourseId" | "name" | "availability">;
type CourseMaterialReadRow = Pick<
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
export const defaultCacheDatabasePath = (): string => {
    const localAppData = Deno.env.get("LOCALAPPDATA");
    return localAppData === undefined
        ? `${Deno.cwd()}/.ku-potato/cache.sqlite3`
        : `${localAppData}/ku-potato/cache.sqlite3`;
};

/**
 * Opens the cache database, applies bundled migrations, and exposes the cache
 * service for the lifetime of the surrounding Effect scope.
 */
export const makeLmsCacheGateway = (
    databasePath = defaultCacheDatabasePath(),
): Effect.Effect<LmsCacheGatewayService, LmsCacheGatewayError, Scope.Scope> =>
    Effect.acquireRelease(
        cacheWriteTry("open", () => {
            Deno.mkdirSync(databaseDirectory(databasePath), { recursive: true });
            const database = drizzle(databasePath);
            database.$client.exec("pragma foreign_keys = on");
            migrate(database, {
                migrationsFolder: fileURLToPath(new URL("./drizzle", import.meta.url)),
            });
            return { database, gateway: LmsCacheGateway.of(makeGateway(database)) };
        }),
        ({ database }) =>
            Effect.sync(() => {
                database.$client.close();
            }),
    ).pipe(Effect.map(({ gateway }) => gateway));

const makeGateway = (database: Database): LmsCacheGatewayService => ({
    listCourses: cacheReadTry("listCourses", () => readCourses(database)),
    listCourseMaterials: (lmsCourseId) =>
        cacheReadTry("listCourseMaterials", () => readCourseMaterials(database, lmsCourseId)),
    listMaterialResources: (lmsCourseId, lmsMaterialId) =>
        cacheReadTry("listMaterialResources", () => readMaterialResources(database, lmsCourseId, lmsMaterialId)),
    appendCourses: (retrievedCourses) =>
        cacheWriteTry("appendCourses", () => recordCourses(database, retrievedCourses)),
    appendCourseMaterials: (refresh) =>
        cacheWriteTry("appendCourseMaterials", () => recordCourseMaterials(database, refresh)),
    appendMaterialResources: (refresh) =>
        cacheWriteTry("appendMaterialResources", () => recordMaterialResources(database, refresh)),
});

const cacheReadTry = <A>(
    operation: string,
    evaluate: () => A,
): Effect.Effect<A, LmsCacheGatewayError | LmsCacheMissError> =>
    Effect.try({
        try: evaluate,
        catch: (cause) =>
            Schema.is(LmsCacheMissError)(cause)
                ? cause
                : new LmsCacheGatewayError({ operation, message: describeCause(cause) }),
    });

const cacheWriteTry = <A>(operation: string, evaluate: () => A): Effect.Effect<A, LmsCacheGatewayError> =>
    Effect.try({
        try: evaluate,
        catch: (cause) => new LmsCacheGatewayError({ operation, message: describeCause(cause) }),
    });

const describeCause = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const recordCourses = (database: Database, retrievedCourses: readonly Course[]): void => {
    insertCourses(database, retrievedCourses);
};

const recordCourseMaterials = (database: Database, refresh: CourseMaterialsRefresh): void => {
    const courseRetrievalId = insertCourses(database, refresh.courses);
    const coursePosition = findCoursePosition(database, courseRetrievalId, refresh.courseMaterials.lmsCourseId);
    const courseMaterialRetrievalId = insertCourseMaterialRetrieval(database, courseRetrievalId, coursePosition);
    insertCourseMaterials(database, courseMaterialRetrievalId, refresh.courseMaterials);
};

const recordMaterialResources = (database: Database, refresh: MaterialResourcesRefresh): void => {
    const courseRetrievalId = insertCourses(database, refresh.courses);
    const coursePosition = findCoursePosition(database, courseRetrievalId, refresh.courseMaterials.lmsCourseId);
    const courseMaterialRetrievalId = insertCourseMaterialRetrieval(database, courseRetrievalId, coursePosition);
    insertCourseMaterials(database, courseMaterialRetrievalId, refresh.courseMaterials);

    const materialPosition = findMaterialPosition(
        database,
        courseMaterialRetrievalId,
        refresh.materialResources.lmsMaterialId,
    );
    const materialResourceRetrieval = database.insert(materialResourceRetrievals).values({
        courseMaterialRetrievalId,
        courseMaterialPosition: materialPosition,
        fetchedAt: now(),
    }).returning({ id: materialResourceRetrievals.id }).get();
    if (materialResourceRetrieval == null) {
        throw new LmsCacheGatewayError({
            operation: "appendMaterialResources",
            message: "Could not create retrieval.",
        });
    }
    const resourceRows = refresh.materialResources.resources.map((resource, position) => ({
        retrievalId: materialResourceRetrieval.id,
        position,
        name: resource.name,
    }));
    if (resourceRows.length > 0) database.insert(materialResources).values(resourceRows).run();
};

const insertCourses = (database: Database, retrievedCourses: readonly Course[]): number => {
    const retrieval = database.insert(courseRetrievals).values({ fetchedAt: now() })
        .returning({ id: courseRetrievals.id }).get();
    if (retrieval == null) {
        throw new LmsCacheGatewayError({ operation: "appendCourses", message: "Could not create retrieval." });
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
    database: Database,
    courseRetrievalId: number,
    coursePosition: number,
): number => {
    const retrieval = database.insert(courseMaterialRetrievals).values({
        courseRetrievalId,
        coursePosition,
        fetchedAt: now(),
    }).returning({ id: courseMaterialRetrievals.id }).get();
    if (retrieval == null) {
        throw new LmsCacheGatewayError({ operation: "appendCourseMaterials", message: "Could not create retrieval." });
    }
    return retrieval.id;
};

const insertCourseMaterials = (database: Database, retrievalId: number, retrievedMaterials: CourseMaterials): void => {
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

const findCoursePosition = (database: Database, retrievalId: number, lmsCourseId: string): number => {
    const row = database.select({ position: courses.position })
        .from(courses)
        .where(and(eq(courses.retrievalId, retrievalId), eq(courses.lmsCourseId, lmsCourseId))).get();
    if (row == null) {
        throw new LmsCacheGatewayError({
            operation: "append",
            message: `The course ${lmsCourseId} was absent from its bundled course retrieval.`,
        });
    }
    return row.position;
};

const findMaterialPosition = (database: Database, retrievalId: number, lmsMaterialId: string): number => {
    const row = database.select({ position: courseMaterials.position })
        .from(courseMaterials)
        .where(and(eq(courseMaterials.retrievalId, retrievalId), eq(courseMaterials.lmsMaterialId, lmsMaterialId)))
        .get();
    if (row == null) {
        throw new LmsCacheGatewayError({
            operation: "append",
            message: `The material ${lmsMaterialId} was absent from its bundled material retrieval.`,
        });
    }
    return row.position;
};

const readCourses = (database: Database): readonly Course[] => {
    const retrieval = database.select({ id: courseRetrievals.id })
        .from(courseRetrievals).orderBy(desc(courseRetrievals.id)).limit(1).get();
    if (retrieval == null) {
        throw cacheMiss("listCourses", "No course retrieval has been synchronized yet.");
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
        .innerJoin(
            courses,
            and(
                eq(courses.retrievalId, courseMaterialRetrievals.courseRetrievalId),
                eq(courses.position, courseMaterialRetrievals.coursePosition),
            ),
        )
        .where(eq(courses.lmsCourseId, lmsCourseId))
        .orderBy(desc(courseMaterialRetrievals.id))
        .limit(1)
        .get();
    if (retrieval == null) {
        throw cacheMiss(
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
            materials: (materialsByFolder.get(folder.position) ?? []).map(decodeCourseMaterial),
        })),
    };
};

const readMaterialResources = (database: Database, lmsCourseId: string, lmsMaterialId: string): MaterialResources => {
    const retrieval = database.select({ id: materialResourceRetrievals.id })
        .from(materialResourceRetrievals)
        .innerJoin(
            courseMaterials,
            and(
                eq(courseMaterials.retrievalId, materialResourceRetrievals.courseMaterialRetrievalId),
                eq(courseMaterials.position, materialResourceRetrievals.courseMaterialPosition),
            ),
        )
        .innerJoin(courseMaterialRetrievals, eq(courseMaterialRetrievals.id, courseMaterials.retrievalId))
        .innerJoin(
            courses,
            and(
                eq(courses.retrievalId, courseMaterialRetrievals.courseRetrievalId),
                eq(courses.position, courseMaterialRetrievals.coursePosition),
            ),
        )
        .where(and(eq(courses.lmsCourseId, lmsCourseId), eq(courseMaterials.lmsMaterialId, lmsMaterialId)))
        .orderBy(desc(materialResourceRetrievals.id))
        .limit(1)
        .get();
    if (retrieval == null) {
        throw cacheMiss(
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
        lmsCourseId: LmsCourseId(lmsCourseId),
        lmsMaterialId: LmsMaterialId(lmsMaterialId),
        resources: resources.map((resource) => ({ name: resource.name })),
    };
};

const decodeCourse = (row: CourseReadRow): Course =>
    row.availability === "available" && row.lmsCourseId !== null
        ? { lmsCourseId: LmsCourseId(row.lmsCourseId), name: row.name, availability: "available" }
        : { name: row.name, availability: "unavailable" };

const decodeCourseMaterial = (row: CourseMaterialReadRow): CourseMaterial => {
    const base = {
        lmsMaterialId: LmsMaterialId(row.lmsMaterialId),
        name: row.name,
        publicationDeadline: decodePublicationDeadline(row),
    };
    return row.type === "material"
        ? { ...base, type: "material", resourceAvailability: row.resourceAvailability ?? "unavailable" }
        : { ...base, type: row.type };
};

const encodePublicationDeadline = (value: CourseMaterial["publicationDeadline"]): {
    readonly publicationDeadlineStatus: "scheduled" | "no-deadline" | "unavailable";
    readonly publicationDeadlineAt: Date | null;
} => value instanceof Date
    ? { publicationDeadlineStatus: "scheduled", publicationDeadlineAt: value }
    : { publicationDeadlineStatus: value, publicationDeadlineAt: null };

const decodePublicationDeadline = (
    row: CourseMaterialReadRow,
): CourseMaterial["publicationDeadline"] =>
    row.publicationDeadlineStatus === "scheduled"
        ? row.publicationDeadlineAt ?? DateTime.toDate(DateTime.makeUnsafe(0))
        : row.publicationDeadlineStatus;

const cacheMiss = (operation: string, message: string): LmsCacheMissError =>
    new LmsCacheMissError({ operation, message });

const now = (): Date => DateTime.toDate(DateTime.nowUnsafe());

const databaseDirectory = (databasePath: string): string => {
    const separatorIndex = Math.max(databasePath.lastIndexOf("/"), databasePath.lastIndexOf("\\"));
    if (separatorIndex === -1) return ".";
    return separatorIndex === 2 && databasePath[1] === ":"
        ? databasePath.slice(0, separatorIndex + 1)
        : databasePath.slice(0, separatorIndex);
};
