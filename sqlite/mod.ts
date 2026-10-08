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
    LmsResourceId,
    type Material,
    type MaterialDetail,
    type MaterialResources,
    type MaterialResourcesSnapshot,
    type Resource,
    type ResourceAcquisition,
    type SavedResourceFile,
} from "../domain/mod.ts";
import { and, asc, desc, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { DateTime, Effect, Layer, Schema, Scope } from "effect";
import { describeSqliteCause, sqliteTry } from "./errors.ts";
import { fileURLToPath } from "node:url";
import { applicationDataPath } from "../platform/directories.ts";
import { withInitializationLock } from "./initialization_lock.ts";
import {
    courseMaterialFolders,
    courseMaterialRetrievals,
    courseMaterials,
    courseMaterialSavedMaterials,
    courseRetrievals,
    courses,
    materialResourceRetrievals,
    materialResources,
    resourceStates,
} from "./schema.ts";

export * from "./schema.ts";

export type Database = ReturnType<typeof drizzle>;
type ArchiveConnection = Pick<Database, "insert" | "select" | "selectDistinct">;
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
    openArchiveDatabase(databasePath).pipe(Effect.map((database) => LmsArchiveGateway.of(makeGateway(database))));

/** Every connection is configured and schema initialization is serialized across processes. */
export const openArchiveDatabase = (
    databasePath: string,
): Effect.Effect<Database, LmsArchiveGatewayError, Scope.Scope> =>
    Effect.acquireRelease(
        withInitializationLock(
            `${databasePath}.init.lock`,
            archiveWriteTry("open", () => {
                Deno.mkdirSync(databaseDirectory(databasePath), { recursive: true });
                const database = drizzle(databasePath);
                try {
                    database.$client.exec(
                        "pragma busy_timeout = 100; pragma journal_mode = WAL; pragma foreign_keys = on",
                    );
                    migrate(database, {
                        migrationsFolder: fileURLToPath(new URL("./drizzle", import.meta.url)),
                    });
                    if (database.$client.prepare("pragma foreign_key_check").all().length > 0) {
                        throw new Error("Archive contains inconsistent foreign keys.");
                    }
                    return database;
                } catch (cause) {
                    database.$client.close();
                    throw cause;
                }
            }),
        ),
        (database) =>
            Effect.sync(() => {
                database.$client.close();
            }),
    );

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
            getResourceState: (materialId, resourceId) =>
                cachedGateway.pipe(Effect.flatMap((archive) => archive.getResourceState(materialId, resourceId))),
            recordResourceAttempt: (materialId, resourceId, attempt) =>
                cachedGateway.pipe(
                    Effect.flatMap((archive) => archive.recordResourceAttempt(materialId, resourceId, attempt)),
                ),
            commitResourceAcquisition: (materialId, resourceId, file, at) =>
                cachedGateway.pipe(
                    Effect.flatMap((archive) => archive.commitResourceAcquisition(materialId, resourceId, file, at)),
                ),
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
    getResourceState: (materialId, resourceId) =>
        archiveWriteTry("getResourceState", () => {
            const row = database.select().from(resourceStates)
                .where(resourceStateKey(materialId, resourceId)).get();
            return row === undefined ? undefined : decodeResourceState(row);
        }),
    recordResourceAttempt: (materialId, resourceId, attempt) =>
        archiveWriteTry("recordResourceAttempt", () => {
            requireResourceState(database, materialId, resourceId);
            database.update(resourceStates).set(encodeAttempt(attempt))
                .where(resourceStateKey(materialId, resourceId)).run();
        }),
    commitResourceAcquisition: (materialId, resourceId, file, at) =>
        archiveWriteTry("commitResourceAcquisition", () =>
            database.transaction((transaction) => {
                const previous = requireResourceState(transaction, materialId, resourceId);
                transaction.update(resourceStates).set({
                    ...(file === undefined ? {} : {
                        fileUuid: file.uuid,
                        originalFilename: file.originalFilename,
                        sha256: file.sha256,
                        fileSize: file.size,
                        fileSourceUrl: file.sourceUrl ?? null,
                    }),
                    lastSucceededAt: at,
                    ...encodeAttempt({ at, status: "success" }),
                }).where(resourceStateKey(materialId, resourceId)).run();
                return decodeSavedFile(previous);
            }, { behavior: "immediate" })),
});

const archiveReadTry = <A>(
    operation: string,
    evaluate: () => A,
): Effect.Effect<A, LmsArchiveGatewayError | LmsArchiveDataMissingError> =>
    sqliteTry(evaluate).pipe(
        Effect.mapError(({ cause }) =>
            Schema.is(LmsArchiveDataMissingError)(cause)
                ? cause
                : new LmsArchiveGatewayError({ operation, message: describeSqliteCause(cause) })
        ),
    );

const archiveWriteTry = <A>(operation: string, evaluate: () => A): Effect.Effect<A, LmsArchiveGatewayError> =>
    sqliteTry(evaluate).pipe(
        Effect.mapError(({ cause }) => new LmsArchiveGatewayError({ operation, message: describeSqliteCause(cause) })),
    );

const recordCourses = (database: Database, retrievedCourses: readonly Course[]): void => {
    database.transaction((transaction) => {
        insertCourses(transaction, retrievedCourses);
    }, { behavior: "immediate" });
};

export const insertCourseMaterialsSnapshot = (
    transaction: ArchiveConnection,
    snapshot: CourseMaterialsSnapshot,
): number => {
    const courseRetrievalId = insertCourses(transaction, snapshot.courses);
    const courseMaterialRetrievalId = insertCourseMaterialRetrieval(
        transaction,
        courseRetrievalId,
        snapshot.courseMaterials.lmsCourseId,
    );
    insertCourseMaterials(transaction, courseMaterialRetrievalId, snapshot.courseMaterials);
    captureSavedMaterials(transaction, courseMaterialRetrievalId);
    return courseMaterialRetrievalId;
};

const recordCourseMaterials = (database: Database, snapshot: CourseMaterialsSnapshot): void => {
    database.transaction((transaction) => insertCourseMaterialsSnapshot(transaction, snapshot), {
        behavior: "immediate",
    });
};

/** Uses immutable saved-material membership and bounded listing history for this retrieval. */
export const readCourseMaterialsSnapshot = (
    database: ArchiveConnection,
    id: number,
): CourseMaterialsSnapshot | undefined => {
    const retrieval = database.select().from(courseMaterialRetrievals).where(eq(courseMaterialRetrievals.id, id)).get();
    if (retrieval === undefined) return undefined;
    return {
        courses: readCourses(database, retrieval.courseRetrievalId, id),
        courseMaterials: readCourseMaterials(database, retrieval.lmsCourseId, retrieval),
    };
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
            lmsResourceId: resource.lmsResourceId,
            type: resource.type,
            sourceKind: resource.sourceKind,
            url: resource.url ?? null,
        }));
        if (resourceRows.length > 0) transaction.insert(materialResources).values(resourceRows).run();
        transaction.update(resourceStates).set({ isCurrent: false })
            .where(eq(resourceStates.lmsMaterialId, snapshot.materialResources.lmsMaterialId)).run();
        for (const resource of snapshot.materialResources.resources) {
            const metadata = {
                name: resource.name,
                type: resource.type,
                sourceKind: resource.sourceKind,
                url: resource.url ?? null,
                isCurrent: true,
            };
            transaction.insert(resourceStates).values({
                lmsMaterialId: snapshot.materialResources.lmsMaterialId,
                lmsResourceId: resource.lmsResourceId,
                ...metadata,
            }).onConflictDoUpdate({
                target: [resourceStates.lmsMaterialId, resourceStates.lmsResourceId],
                set: metadata,
            }).run();
        }
        captureSavedMaterials(transaction, courseMaterialRetrievalId);
    }, { behavior: "immediate" });
};

const readSavedMaterialIds = (
    database: Pick<Database, "select" | "selectDistinct">,
    exactRetrievalId?: number,
): string[] =>
    exactRetrievalId === undefined
        ? database.selectDistinct({ id: resourceStates.lmsMaterialId }).from(resourceStates)
            .where(or(isNotNull(resourceStates.fileUuid), isNotNull(resourceStates.url))).all().map((row) => row.id)
        : database.select({ id: courseMaterialSavedMaterials.lmsMaterialId }).from(courseMaterialSavedMaterials)
            .where(eq(courseMaterialSavedMaterials.retrievalId, exactRetrievalId)).all().map((row) => row.id);

const captureSavedMaterials = (database: ArchiveConnection, retrievalId: number): void => {
    const rows = readSavedMaterialIds(database).map((lmsMaterialId) => ({ retrievalId, lmsMaterialId }));
    if (rows.length > 0) database.insert(courseMaterialSavedMaterials).values(rows).run();
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

const readCourses = (
    database: ArchiveConnection,
    exactRetrievalId?: number,
    materialRetrievalLimit?: number,
): readonly Course[] => {
    const retrieval = database.select({ id: courseRetrievals.id })
        .from(courseRetrievals).where(
            exactRetrievalId === undefined ? undefined : eq(courseRetrievals.id, exactRetrievalId),
        )
        .orderBy(desc(courseRetrievals.id)).limit(1).get();
    if (retrieval == null) {
        throw archiveDataMissing("listCourses", "No course retrieval has been synchronized yet.");
    }
    const currentCourses = database.select({
        lmsCourseId: courses.lmsCourseId,
        name: courses.name,
        availability: courses.availability,
    }).from(courses).where(eq(courses.retrievalId, retrieval.id)).orderBy(asc(courses.position)).all()
        .map(decodeCourse);
    const knownIds = new Set(
        currentCourses.flatMap((course) => course.availability === "available" ? [course.lmsCourseId] : []),
    );
    const archivedCourses: Course[] = [];
    for (const placement of readSavedMaterialPlacements(database, materialRetrievalLimit)) {
        const id = LmsCourseId(placement.courseLmsCourseId);
        if (knownIds.has(id)) continue;
        knownIds.add(id);
        archivedCourses.push({
            lmsCourseId: id,
            name: placement.courseName,
            availability: "available",
            archived: true,
        });
    }
    return [...currentCourses, ...archivedCourses];
};

/** Only materials with archived bytes or a saved external URL keep their navigation hierarchy. */
const readSavedMaterialPlacements = (database: ArchiveConnection, materialRetrievalLimit?: number) => {
    const savedIds = readSavedMaterialIds(database, materialRetrievalLimit);
    if (savedIds.length === 0) return [];
    const rows = database.select({
        retrievalId: courseMaterials.retrievalId,
        courseLmsCourseId: courseMaterialRetrievals.lmsCourseId,
        courseName: courses.name,
        folderName: courseMaterialFolders.name,
        folderClassDate: courseMaterialFolders.classDate,
        folderPosition: courseMaterials.folderPosition,
        lmsMaterialId: courseMaterials.lmsMaterialId,
        name: courseMaterials.name,
        type: courseMaterials.type,
        publicationDeadlineStatus: courseMaterials.publicationDeadlineStatus,
        publicationDeadlineAt: courseMaterials.publicationDeadlineAt,
        resourceAvailability: courseMaterials.resourceAvailability,
    }).from(courseMaterials)
        .innerJoin(courseMaterialRetrievals, eq(courseMaterialRetrievals.id, courseMaterials.retrievalId))
        .innerJoin(
            courses,
            and(
                eq(courses.retrievalId, courseMaterialRetrievals.courseRetrievalId),
                eq(courses.position, courseMaterialRetrievals.coursePosition),
                eq(courses.lmsCourseId, courseMaterialRetrievals.lmsCourseId),
            ),
        )
        .innerJoin(
            courseMaterialFolders,
            and(
                eq(courseMaterialFolders.retrievalId, courseMaterials.retrievalId),
                eq(courseMaterialFolders.position, courseMaterials.folderPosition),
            ),
        )
        .where(
            and(
                inArray(courseMaterials.lmsMaterialId, savedIds),
                materialRetrievalLimit === undefined
                    ? undefined
                    : lte(courseMaterials.retrievalId, materialRetrievalLimit),
            ),
        )
        .orderBy(desc(courseMaterials.retrievalId), asc(courseMaterials.position)).all();
    const seen = new Set<string>();
    return rows.filter((row) => {
        if (seen.has(row.lmsMaterialId)) return false;
        seen.add(row.lmsMaterialId);
        return true;
    });
};

const isCourseCurrent = (database: ArchiveConnection, courseId: string, exactCourseRetrievalId?: number): boolean => {
    const latest = database.select({ id: courseRetrievals.id }).from(courseRetrievals)
        .where(exactCourseRetrievalId === undefined ? undefined : eq(courseRetrievals.id, exactCourseRetrievalId))
        .orderBy(desc(courseRetrievals.id)).limit(1).get();
    if (latest === undefined) return false;
    return database.select({ id: courses.lmsCourseId }).from(courses)
        .where(
            and(
                eq(courses.retrievalId, latest.id),
                eq(courses.lmsCourseId, courseId),
                eq(courses.availability, "available"),
            ),
        ).get() !== undefined;
};

const archivedMaterial = (material: Material): Material => ({
    ...material,
    archived: true,
    ...(material.type === "material" ? { resourceAvailability: "unavailable" as const } : {}),
});

const readCourseMaterials = (
    database: ArchiveConnection,
    lmsCourseId: string,
    exactRetrieval?: typeof courseMaterialRetrievals.$inferSelect,
): CourseMaterials => {
    const retrieval = database.select({ id: courseMaterialRetrievals.id })
        .from(courseMaterialRetrievals)
        .where(
            and(
                eq(courseMaterialRetrievals.lmsCourseId, lmsCourseId),
                exactRetrieval === undefined ? undefined : eq(courseMaterialRetrievals.id, exactRetrieval.id),
            ),
        )
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
    const savedPlacements = readSavedMaterialPlacements(database, exactRetrieval?.id).filter((row) =>
        row.courseLmsCourseId === lmsCourseId
    );
    const savedIds = new Set(savedPlacements.map((row) => row.lmsMaterialId));
    const courseCurrent = isCourseCurrent(database, lmsCourseId, exactRetrieval?.courseRetrievalId);
    const visibleFolders = folders.map((folder) => ({
        name: folder.name,
        ...(folder.classDate === null ? {} : { classDate: folder.classDate }),
        materials: (materialsByFolder.get(folder.position) ?? [])
            .filter((material) => courseCurrent || savedIds.has(material.lmsMaterialId))
            .map((material) => courseCurrent ? decodeMaterial(material) : archivedMaterial(decodeMaterial(material))),
    }));
    const visibleIds = new Set(
        visibleFolders.flatMap((folder) => folder.materials.map((material) => material.lmsMaterialId)),
    );
    for (const saved of savedPlacements) {
        if (visibleIds.has(LmsMaterialId(saved.lmsMaterialId))) continue;
        const folder = visibleFolders.find((candidate) =>
            candidate.name === saved.folderName &&
            candidate.classDate?.getTime() === saved.folderClassDate?.getTime()
        );
        const material = archivedMaterial(decodeMaterial(saved));
        if (folder !== undefined) folder.materials.push(material);
        else {visibleFolders.push({
                name: saved.folderName,
                ...(saved.folderClassDate === null ? {} : { classDate: saved.folderClassDate }),
                materials: [material],
            });}
    }
    return {
        lmsCourseId: LmsCourseId(lmsCourseId),
        folders: courseCurrent ? visibleFolders : visibleFolders.filter((folder) => folder.materials.length > 0),
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
    const resources = database.select()
        .from(materialResources)
        .where(eq(materialResources.retrievalId, retrieval.id))
        .orderBy(asc(materialResources.position))
        .all();
    const states = database.select().from(resourceStates)
        .where(eq(resourceStates.lmsMaterialId, lmsMaterialId)).all();
    const byId = new Map(states.map((state) => [state.lmsResourceId, state]));
    return {
        lmsMaterialId: LmsMaterialId(lmsMaterialId),
        resources: [
            ...resources.map((resource): Resource => {
                const state = byId.get(resource.lmsResourceId);
                if (state === undefined) throw new Error(`Missing resource state ${resource.lmsResourceId}.`);
                return decodeResourceState(state);
            }),
            ...states.filter((state) => !state.isCurrent && (state.fileUuid !== null || state.url !== null))
                .map(decodeResourceState),
        ],
    };
};

const resourceStateKey = (materialId: string, resourceId: string) =>
    and(eq(resourceStates.lmsMaterialId, materialId), eq(resourceStates.lmsResourceId, resourceId));

const requireResourceState = (database: Pick<Database, "select">, materialId: string, resourceId: string) => {
    const row = database.select().from(resourceStates).where(resourceStateKey(materialId, resourceId)).get();
    if (row === undefined) throw new Error(`No metadata for resource ${resourceId} in material ${materialId}.`);
    return row;
};

const encodeAttempt = (attempt: ResourceAcquisition["lastAttempt"]) => ({
    lastAttemptAt: attempt.at,
    lastAttemptStatus: attempt.status,
    lastAttemptError: attempt.error ?? null,
});

const decodeSavedFile = (row: typeof resourceStates.$inferSelect): SavedResourceFile | undefined => {
    if (row.fileUuid === null) return undefined;
    if (row.originalFilename === null || row.sha256 === null || row.fileSize === null) {
        throw new Error(`Incomplete file metadata for resource ${row.lmsResourceId}.`);
    }
    return {
        uuid: row.fileUuid,
        originalFilename: row.originalFilename,
        sha256: row.sha256,
        size: row.fileSize,
        ...(row.fileSourceUrl === null ? {} : { sourceUrl: row.fileSourceUrl }),
    };
};

const decodeResourceState = (row: typeof resourceStates.$inferSelect): Resource => {
    const savedFile = decodeSavedFile(row);
    return {
        name: row.name,
        lmsResourceId: LmsResourceId(row.lmsResourceId),
        type: row.type,
        sourceKind: row.sourceKind,
        ...(row.url === null ? {} : { url: row.url }),
        availability: row.isCurrent ? "current" : "archived",
        ...(savedFile === undefined ? {} : { savedFile }),
        ...(row.lastAttemptAt === null || row.lastAttemptStatus === null ? {} : {
            acquisition: {
                ...(row.lastSucceededAt === null ? {} : { lastSucceededAt: row.lastSucceededAt }),
                lastAttempt: {
                    at: row.lastAttemptAt,
                    status: row.lastAttemptStatus,
                    ...(row.lastAttemptError === null ? {} : { error: row.lastAttemptError }),
                },
            },
        }),
    };
};

const readMaterialDetail = (database: Database, lmsMaterialId: string): MaterialDetail => {
    const row = database.select({
        retrievalId: courseMaterials.retrievalId,
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
    const courseCurrent = isCourseCurrent(database, row.courseLmsCourseId);
    const latestMaterialRetrieval = database.select({ id: courseMaterialRetrievals.id }).from(courseMaterialRetrievals)
        .where(eq(courseMaterialRetrievals.lmsCourseId, row.courseLmsCourseId))
        .orderBy(desc(courseMaterialRetrievals.id)).limit(1).get();
    const materialCurrent = courseCurrent && latestMaterialRetrieval?.id === row.retrievalId;
    const material = materialCurrent ? decodeMaterial(row) : archivedMaterial(decodeMaterial(row));
    const resources = material.type === "material" ? readMaterialResources(database, lmsMaterialId).resources : [];
    const resourcesCurrent = materialCurrent && material.type === "material" &&
        material.resourceAvailability === "available";
    return {
        course: {
            lmsCourseId: LmsCourseId(row.courseLmsCourseId),
            name: row.courseName,
            availability: "available",
            ...(courseCurrent ? {} : { archived: true }),
        },
        material,
        resources: resourcesCurrent
            ? resources
            : resources.filter((resource) => resource.savedFile !== undefined || resource.url !== undefined)
                .map((resource) => ({ ...resource, availability: "archived" })),
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
