import { eq } from "drizzle-orm";
import { Option, Schema } from "effect";
import type { CourseMaterialsJobDefinition } from "../core/out_port.ts";
import { defineJobStorageAdapter } from "./job_storage.ts";
import { insertCourseMaterialsSnapshot, readCourseMaterialsSnapshot } from "./mod.ts";
import { courseMaterialJobs } from "./schema.ts";

const CourseId = Schema.String.pipe(Schema.brand("LmsCourseId"));
const MaterialId = Schema.String.pipe(Schema.brand("LmsMaterialId"));
const Archived = { archived: Schema.optional(Schema.Literal(true)) };
const Course = Schema.Union([
    Schema.Struct({
        lmsCourseId: CourseId,
        name: Schema.String,
        availability: Schema.Literal("available"),
        ...Archived,
    }),
    Schema.Struct({ name: Schema.String, availability: Schema.Literal("unavailable"), ...Archived }),
]);
const materialBase = {
    lmsMaterialId: MaterialId,
    name: Schema.String,
    publicationDeadline: Schema.Union([Schema.Date, Schema.Literals(["no-deadline", "unavailable"])]),
    ...Archived,
};
const Material = Schema.Union([
    Schema.Struct({
        ...materialBase,
        type: Schema.Literal("material"),
        resourceAvailability: Schema.Literals(["available", "unavailable"]),
    }),
    Schema.Struct({ ...materialBase, type: Schema.Literals(["report", "test", "questionnaire", "e-learning"]) }),
]);

export const courseMaterialsJobAdapter = defineJobStorageAdapter<CourseMaterialsJobDefinition>({
    kind: "fetch-course-materials",
    inputSchema: Schema.Struct({ lmsCourseId: CourseId, head: Schema.Literals(["auto", "true", "false"]) }),
    outputSchema: Schema.Struct({
        courses: Schema.Array(Course),
        courseMaterials: Schema.Struct({
            lmsCourseId: CourseId,
            folders: Schema.Array(Schema.Struct({
                name: Schema.String,
                classDate: Schema.optional(Schema.Date),
                materials: Schema.Array(Material),
            })),
        }),
    }),
    dedupKey: ({ lmsCourseId, head }) => `${head}:${lmsCourseId}`,
    insertInput: (database, jobId, input) => {
        database.insert(courseMaterialJobs).values({ jobId, ...input }).run();
    },
    readInput: (database, jobId) => {
        const row = database.select().from(courseMaterialJobs).where(eq(courseMaterialJobs.jobId, jobId)).get();
        return row === undefined ? undefined : { lmsCourseId: row.lmsCourseId, head: row.head };
    },
    saveResult: (database, job, snapshot) => {
        if (snapshot.courseMaterials.lmsCourseId !== job.input.lmsCourseId) {
            throw new Error("The snapshot belongs to another course.");
        }
        const resultRef = insertCourseMaterialsSnapshot(database, snapshot);
        database.update(courseMaterialJobs).set({ resultRef }).where(eq(courseMaterialJobs.jobId, job.id)).run();
    },
    readResult: (database, jobId) => {
        const row = database.select().from(courseMaterialJobs).where(eq(courseMaterialJobs.jobId, jobId)).get();
        return row?.resultRef == null
            ? Option.none()
            : Option.fromUndefinedOr(readCourseMaterialsSnapshot(database, row.resultRef));
    },
});
