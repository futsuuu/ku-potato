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
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { DateTime, Effect, Schema, Scope } from "effect";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export * from "./schema.ts";

type Database = ReturnType<typeof drizzle>;

type CourseRow = {
    readonly retrieval_id: number;
    readonly position: number;
    readonly lms_course_id: string | null;
    readonly name: string;
    readonly availability: Course["availability"];
};

type FolderRow = {
    readonly position: number;
    readonly name: string;
    readonly class_date: number | null;
};

type MaterialRow = {
    readonly position: number;
    readonly folder_position: number;
    readonly lms_material_id: string;
    readonly name: string;
    readonly type: CourseMaterial["type"];
    readonly publication_deadline_status: "scheduled" | "no-deadline" | "unavailable";
    readonly publication_deadline_at: number | null;
    readonly resource_availability: "available" | "unavailable" | null;
};

type ResourceRow = {
    readonly position: number;
    readonly name: string;
};

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
            Deno.mkdirSync(dirname(databasePath), { recursive: true });
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
    appendCourses: (courses) => cacheWriteTry("appendCourses", () => recordCourses(database, courses)),
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

const transaction = <A>(database: Database, work: () => A): A => {
    database.$client.exec("begin immediate");
    try {
        const result = work();
        database.$client.exec("commit");
        return result;
    } catch (cause) {
        database.$client.exec("rollback");
        throw cause;
    }
};

const recordCourses = (database: Database, retrievedCourses: readonly Course[]): void => {
    transaction(database, () => {
        insertCourses(database, retrievedCourses);
    });
};

const recordCourseMaterials = (database: Database, refresh: CourseMaterialsRefresh): void => {
    transaction(database, () => {
        const courseRetrievalId = insertCourses(database, refresh.courses);
        const coursePosition = findCoursePosition(database, courseRetrievalId, refresh.courseMaterials.lmsCourseId);
        const courseMaterialRetrievalId = insertCourseMaterialRetrieval(database, courseRetrievalId, coursePosition);
        insertCourseMaterials(database, courseMaterialRetrievalId, refresh.courseMaterials);
    });
};

const recordMaterialResources = (database: Database, refresh: MaterialResourcesRefresh): void => {
    transaction(database, () => {
        const courseRetrievalId = insertCourses(database, refresh.courses);
        const coursePosition = findCoursePosition(database, courseRetrievalId, refresh.courseMaterials.lmsCourseId);
        const courseMaterialRetrievalId = insertCourseMaterialRetrieval(database, courseRetrievalId, coursePosition);
        insertCourseMaterials(database, courseMaterialRetrievalId, refresh.courseMaterials);

        const materialPosition = findMaterialPosition(
            database,
            courseMaterialRetrievalId,
            refresh.materialResources.lmsMaterialId,
        );
        const materialResourceRetrieval = database.$client.prepare(
            `insert into material_resource_retrievals
                (course_material_retrieval_id, course_material_position, fetched_at)
             values (?, ?, ?)
             returning id`,
        ).get(courseMaterialRetrievalId, materialPosition, now()) as { id: number };

        refresh.materialResources.resources.forEach((resource, position) => {
            database.$client.prepare(
                "insert into material_resources (retrieval_id, position, name) values (?, ?, ?)",
            ).run(materialResourceRetrieval.id, position, resource.name);
        });
    });
};

const insertCourses = (database: Database, retrievedCourses: readonly Course[]): number => {
    const retrieval = database.$client.prepare(
        "insert into course_retrievals (fetched_at) values (?) returning id",
    ).get(now()) as { id: number };

    retrievedCourses.forEach((course, position) => {
        database.$client.prepare(
            `insert into courses (retrieval_id, position, lms_course_id, name, availability)
             values (?, ?, ?, ?, ?)`,
        ).run(
            retrieval.id,
            position,
            course.availability === "available" ? course.lmsCourseId : null,
            course.name,
            course.availability,
        );
    });
    return retrieval.id;
};

const insertCourseMaterialRetrieval = (database: Database, courseRetrievalId: number, coursePosition: number): number =>
    (database.$client.prepare(
        `insert into course_material_retrievals (course_retrieval_id, course_position, fetched_at)
         values (?, ?, ?)
         returning id`,
    ).get(courseRetrievalId, coursePosition, now()) as { id: number }).id;

const insertCourseMaterials = (database: Database, retrievalId: number, courseMaterials: CourseMaterials): void => {
    courseMaterials.folders.forEach((folder, folderPosition) => {
        database.$client.prepare(
            "insert into course_material_folders (retrieval_id, position, name, class_date) values (?, ?, ?, ?)",
        ).run(retrievalId, folderPosition, folder.name, folder.classDate?.getTime() ?? null);
    });

    let materialPosition = 0;
    for (const [folderPosition, folder] of courseMaterials.folders.entries()) {
        for (const material of folder.materials) {
            const deadline = encodePublicationDeadline(material.publicationDeadline);
            database.$client.prepare(
                `insert into course_materials
                    (retrieval_id, position, lms_material_id, folder_position, name, type,
                     publication_deadline_status, publication_deadline_at, resource_availability)
                 values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(
                retrievalId,
                materialPosition,
                material.lmsMaterialId,
                folderPosition,
                material.name,
                material.type,
                deadline.status,
                deadline.at,
                material.type === "material" ? material.resourceAvailability : null,
            );
            materialPosition += 1;
        }
    }
};

const findCoursePosition = (database: Database, retrievalId: number, lmsCourseId: string): number => {
    const row = database.$client.prepare(
        "select position from courses where retrieval_id = ? and lms_course_id = ?",
    ).get(retrievalId, lmsCourseId) as { position: number } | undefined;
    if (row === undefined) {
        throw new LmsCacheGatewayError({
            operation: "append",
            message: `The course ${lmsCourseId} was absent from its bundled course retrieval.`,
        });
    }
    return row.position;
};

const findMaterialPosition = (database: Database, retrievalId: number, lmsMaterialId: string): number => {
    const row = database.$client.prepare(
        "select position from course_materials where retrieval_id = ? and lms_material_id = ?",
    ).get(retrievalId, lmsMaterialId) as { position: number } | undefined;
    if (row === undefined) {
        throw new LmsCacheGatewayError({
            operation: "append",
            message: `The material ${lmsMaterialId} was absent from its bundled material retrieval.`,
        });
    }
    return row.position;
};

const readCourses = (database: Database): readonly Course[] => {
    const retrieval = database.$client.prepare(
        "select id from course_retrievals order by id desc limit 1",
    ).get() as { id: number } | undefined;
    if (retrieval === undefined) {
        throw cacheMiss("listCourses", "No course retrieval has been synchronized yet.");
    }
    const rows = database.$client.prepare(
        "select retrieval_id, position, lms_course_id, name, availability from courses where retrieval_id = ? order by position",
    ).all(retrieval.id) as CourseRow[];
    return rows.map(decodeCourse);
};

const readCourseMaterials = (database: Database, lmsCourseId: string): CourseMaterials => {
    const retrieval = database.$client.prepare(
        `select cmr.id
         from course_material_retrievals cmr
         join courses c on c.retrieval_id = cmr.course_retrieval_id and c.position = cmr.course_position
         where c.lms_course_id = ?
         order by cmr.id desc
         limit 1`,
    ).get(lmsCourseId) as { id: number } | undefined;
    if (retrieval === undefined) {
        throw cacheMiss(
            "listCourseMaterials",
            `No material retrieval for course ${lmsCourseId} has been synchronized yet.`,
        );
    }

    const folders = database.$client.prepare(
        "select position, name, class_date from course_material_folders where retrieval_id = ? order by position",
    ).all(retrieval.id) as FolderRow[];
    const materialRows = database.$client.prepare(
        `select position, folder_position, lms_material_id, name, type, publication_deadline_status,
                publication_deadline_at, resource_availability
         from course_materials where retrieval_id = ? order by position`,
    ).all(retrieval.id) as MaterialRow[];
    const materialByFolder = Map.groupBy(materialRows, (material) => material.folder_position);

    return {
        lmsCourseId: LmsCourseId(lmsCourseId),
        folders: folders.map((folder) => ({
            name: folder.name,
            ...(folder.class_date === null
                ? {}
                : { classDate: DateTime.toDate(DateTime.makeUnsafe(folder.class_date)) }),
            materials: (materialByFolder.get(folder.position) ?? []).map(decodeCourseMaterial),
        })),
    };
};

const readMaterialResources = (database: Database, lmsCourseId: string, lmsMaterialId: string): MaterialResources => {
    const retrieval = database.$client.prepare(
        `select mrr.id
         from material_resource_retrievals mrr
         join course_materials cm on cm.retrieval_id = mrr.course_material_retrieval_id
             and cm.position = mrr.course_material_position
         join course_material_retrievals cmr on cmr.id = cm.retrieval_id
         join courses c on c.retrieval_id = cmr.course_retrieval_id and c.position = cmr.course_position
         where c.lms_course_id = ? and cm.lms_material_id = ?
         order by mrr.id desc
         limit 1`,
    ).get(lmsCourseId, lmsMaterialId) as { id: number } | undefined;
    if (retrieval === undefined) {
        throw cacheMiss(
            "listMaterialResources",
            `No resource retrieval for material ${lmsMaterialId} has been synchronized yet.`,
        );
    }
    const rows = database.$client.prepare(
        "select position, name from material_resources where retrieval_id = ? order by position",
    ).all(retrieval.id) as ResourceRow[];
    return {
        lmsCourseId: LmsCourseId(lmsCourseId),
        lmsMaterialId: LmsMaterialId(lmsMaterialId),
        resources: rows.map((row) => ({ name: row.name })),
    };
};

const decodeCourse = (row: CourseRow): Course =>
    row.availability === "available" && row.lms_course_id !== null
        ? { lmsCourseId: LmsCourseId(row.lms_course_id), name: row.name, availability: "available" }
        : { name: row.name, availability: "unavailable" };

const decodeCourseMaterial = (row: MaterialRow): CourseMaterial => {
    const base = {
        lmsMaterialId: LmsMaterialId(row.lms_material_id),
        name: row.name,
        publicationDeadline: decodePublicationDeadline(row),
    };
    return row.type === "material"
        ? { ...base, type: "material", resourceAvailability: row.resource_availability ?? "unavailable" }
        : { ...base, type: row.type };
};

const encodePublicationDeadline = (value: CourseMaterial["publicationDeadline"]): {
    readonly status: "scheduled" | "no-deadline" | "unavailable";
    readonly at: number | null;
} => value instanceof Date ? { status: "scheduled", at: value.getTime() } : { status: value, at: null };

const decodePublicationDeadline = (row: MaterialRow): CourseMaterial["publicationDeadline"] =>
    row.publication_deadline_status === "scheduled"
        ? DateTime.toDate(DateTime.makeUnsafe(row.publication_deadline_at ?? 0))
        : row.publication_deadline_status;

const cacheMiss = (operation: string, message: string): LmsCacheMissError =>
    new LmsCacheMissError({ operation, message });

const now = (): number => DateTime.toEpochMillis(DateTime.nowUnsafe());
