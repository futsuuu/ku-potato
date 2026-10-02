/** Persistent cache schema. */

import type { Course, Material } from "../domain/mod.ts";
import { foreignKey, index, integer, primaryKey, snakeCase, text, unique } from "drizzle-orm/sqlite-core";

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
    index("courses_lms_course_id_index").on(table.lmsCourseId),
]);

/** One successful execution of `listMaterials` for one course. */
export const courseMaterialRetrievals = snakeCase.table("course_material_retrievals", {
    id: integer().primaryKey({ autoIncrement: true }),
    courseRetrievalId: integer().notNull(),
    coursePosition: integer().notNull(),
    fetchedAt: integer({ mode: "timestamp_ms" }).notNull(),
}, (table) => [
    foreignKey({
        columns: [table.courseRetrievalId, table.coursePosition],
        foreignColumns: [courses.retrievalId, courses.position],
        name: "course_material_retrievals_course_fk",
    }).onDelete("cascade"),
    index("course_material_retrievals_course_fetched_at_index").on(
        table.courseRetrievalId,
        table.coursePosition,
        table.fetchedAt,
    ),
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
}, (table) => [
    primaryKey({ columns: [table.retrievalId, table.position] }),
]);
