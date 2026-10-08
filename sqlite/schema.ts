/** Persistent archive schema. */

import type { Course, Material, Resource } from "../domain/mod.ts";
import {
    check,
    foreignKey,
    index,
    integer,
    primaryKey,
    snakeCase,
    text,
    unique,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/** Durable work shared by all application processes using this account's database. */
export const jobs = snakeCase.table("jobs", {
    id: integer().primaryKey({ autoIncrement: true }),
    kind: text().notNull(),
    dedupKey: text().notNull(),
    status: text().$type<"queued" | "running" | "succeeded" | "failed" | "blocked">().notNull(),
    availableAt: integer().notNull(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(3),
    ownerId: text(),
    leaseToken: text(),
    leaseUntil: integer(),
    lastError: text(),
    errorTag: text(),
}, (table) => [
    unique("jobs_id_kind_unique").on(table.id, table.kind),
    uniqueIndex("jobs_active_unique").on(table.kind, table.dedupKey)
        .where(sql`${table.status} in ('queued', 'running')`),
    index("jobs_claim_index").on(table.status, table.availableAt, table.id),
]);

/** Operation-specific input and a typed reference to its immutable result. */
export const courseMaterialJobs = snakeCase.table("course_material_jobs", {
    jobId: integer().primaryKey(),
    kind: text().$type<"fetch-course-materials">().notNull().default("fetch-course-materials"),
    lmsCourseId: text().notNull(),
    head: text().$type<"auto" | "true" | "false">().notNull(),
    resultRef: integer().references(() => courseMaterialRetrievals.id),
}, (table) => [
    check("course_material_jobs_kind_check", sql`${table.kind} = 'fetch-course-materials'`),
    foreignKey({ columns: [table.jobId, table.kind], foreignColumns: [jobs.id, jobs.kind] }).onDelete("cascade"),
]);

type MaterialType = Material["type"];
type ResourceAvailability = Extract<Material, { readonly type: "material" }>["resourceAvailability"];
type PublicationDeadlineStatus = "scheduled" | "no-deadline" | "unavailable";

/** One successful execution of the `listCourses` primitive. */
export const courseRetrievals = snakeCase.table("course_retrievals", {
    id: integer().primaryKey({ autoIncrement: true }),
    fetchedAt: integer({ mode: "timestamp_ms" }).notNull(),
});

/**
 * A course as it appeared in one `listCourses` retrieval.
 *
 * `lmsCourseId` is null for courses shown without an openable link.  Keeping a
 * position within a retrieval preserves those entries without inventing an ID.
 */
export const courses = snakeCase.table("courses", {
    retrievalId: integer().notNull().references(() => courseRetrievals.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    lmsCourseId: text(),
    name: text().notNull(),
    availability: text().$type<Course["availability"]>().notNull(),
}, (table) => [
    primaryKey({ columns: [table.retrievalId, table.position] }),
    unique("courses_retrieval_position_course_id_unique").on(table.retrievalId, table.position, table.lmsCourseId),
    index("courses_lms_course_id_index").on(table.lmsCourseId),
]);

/** One successful execution of `listMaterials` for one course. */
export const courseMaterialRetrievals = snakeCase.table("course_material_retrievals", {
    id: integer().primaryKey({ autoIncrement: true }),
    courseRetrievalId: integer().notNull(),
    coursePosition: integer().notNull(),
    lmsCourseId: text().notNull(),
    fetchedAt: integer({ mode: "timestamp_ms" }).notNull(),
}, (table) => [
    foreignKey({
        columns: [table.courseRetrievalId, table.coursePosition, table.lmsCourseId],
        foreignColumns: [courses.retrievalId, courses.position, courses.lmsCourseId],
        name: "course_material_retrievals_course_fk",
    }).onDelete("cascade"),
    index("course_material_retrievals_course_fetched_at_index").on(
        table.courseRetrievalId,
        table.coursePosition,
        table.fetchedAt,
    ),
]);

/** Saved materials eligible for archive overlays when this retrieval was committed. */
export const courseMaterialSavedMaterials = snakeCase.table("course_material_saved_materials", {
    retrievalId: integer().notNull().references(() => courseMaterialRetrievals.id, { onDelete: "cascade" }),
    lmsMaterialId: text().notNull(),
}, (table) => [
    primaryKey({ columns: [table.retrievalId, table.lmsMaterialId] }),
]);

/** A folder as it appeared in one course-material retrieval. */
export const courseMaterialFolders = snakeCase.table("course_material_folders", {
    retrievalId: integer().notNull().references(() => courseMaterialRetrievals.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    name: text().notNull(),
    classDate: integer({ mode: "timestamp_ms" }),
}, (table) => [
    primaryKey({ columns: [table.retrievalId, table.position] }),
]);

/** A material as it appeared in one course-material retrieval. */
export const courseMaterials = snakeCase.table("course_materials", {
    retrievalId: integer().notNull().references(() => courseMaterialRetrievals.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    lmsMaterialId: text().notNull(),
    folderPosition: integer().notNull(),
    name: text().notNull(),
    type: text().$type<MaterialType>().notNull(),
    publicationDeadlineStatus: text().$type<PublicationDeadlineStatus>().notNull(),
    publicationDeadlineAt: integer({ mode: "timestamp_ms" }),
    resourceAvailability: text().$type<ResourceAvailability>(),
}, (table) => [
    primaryKey({ columns: [table.retrievalId, table.position] }),
    unique("course_materials_retrieval_material_id_unique").on(table.retrievalId, table.lmsMaterialId),
    index("course_materials_material_retrieval_index").on(table.lmsMaterialId, table.retrievalId),
    foreignKey({
        columns: [table.retrievalId, table.folderPosition],
        foreignColumns: [courseMaterialFolders.retrievalId, courseMaterialFolders.position],
        name: "course_materials_folder_fk",
    }),
]);

/** One successful execution of `listMaterialResources` for one globally identified material. */
export const materialResourceRetrievals = snakeCase.table("material_resource_retrievals", {
    id: integer().primaryKey({ autoIncrement: true }),
    lmsMaterialId: text().notNull(),
    fetchedAt: integer({ mode: "timestamp_ms" }).notNull(),
}, (table) => [
    index("material_resource_retrievals_material_fetched_at_index").on(
        table.lmsMaterialId,
        table.fetchedAt,
    ),
]);

/** A resource as it appeared in one material-resource retrieval. */
export const materialResources = snakeCase.table("material_resources", {
    retrievalId: integer().notNull().references(() => materialResourceRetrievals.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    name: text().notNull(),
    lmsResourceId: text().notNull(),
    type: text().$type<Resource["type"]>().notNull(),
    sourceKind: text().notNull(),
    url: text(),
}, (table) => [
    primaryKey({ columns: [table.retrievalId, table.position] }),
    unique("material_resources_retrieval_resource_id_unique").on(table.retrievalId, table.lmsResourceId),
]);

/** Mutable metadata and the latest successful file, independently of listing snapshots. */
export const resourceStates = snakeCase.table("resource_states", {
    lmsMaterialId: text().notNull(),
    lmsResourceId: text().notNull(),
    name: text().notNull(),
    type: text().$type<Resource["type"]>().notNull(),
    sourceKind: text().notNull(),
    url: text(),
    isCurrent: integer({ mode: "boolean" }).notNull(),
    fileUuid: text(),
    originalFilename: text(),
    sha256: text(),
    fileSize: integer(),
    fileSourceUrl: text(),
    lastSucceededAt: integer({ mode: "timestamp_ms" }),
    lastAttemptAt: integer({ mode: "timestamp_ms" }),
    lastAttemptStatus: text().$type<"success" | "failure">(),
    lastAttemptError: text(),
}, (table) => [
    primaryKey({ columns: [table.lmsMaterialId, table.lmsResourceId] }),
]);
