import { Application, ApplicationError, type QueryError, type SyncPolicy } from "../core/in_port.ts";
import { LmsCourseId, LmsMaterialId, type Material } from "../domain/mod.ts";
import { Effect } from "effect";
import type { DesktopMaterial, DesktopQueryResult } from "./bindings.ts";

const toDesktopResult = <A>(operation: Effect.Effect<A, QueryError, Application>) =>
    operation.pipe(Effect.match({
        onSuccess: (data): DesktopQueryResult<A> => ({ status: "success", data }),
        onFailure: (error): DesktopQueryResult<A> => ({
            status: "error",
            error: { reason: error.reason, message: error.message },
        }),
    }));

const serializeMaterial = (material: Material): DesktopMaterial => ({
    ...material,
    publicationDeadline: material.publicationDeadline instanceof Date
        ? material.publicationDeadline.toISOString()
        : material.publicationDeadline,
});

/** Queries the application and returns a serializable result for the webview. */
const listCourses = Effect.fn("DesktopInboundAdapter.listCourses")(function* (sync: SyncPolicy) {
    const application = yield* Application;
    return yield* application.listCourses.execute({ sync, head: "auto" });
}, toDesktopResult);

const listMaterials = Effect.fn("DesktopInboundAdapter.listMaterials")(function* (
    courseId: string,
    sync: SyncPolicy,
) {
    const application = yield* Application;
    const lmsCourseId = LmsCourseId(courseId);
    const result = yield* application.listMaterials.execute({ lmsCourseIds: [lmsCourseId], sync, head: "auto" });
    const failure = result.failures[0];
    if (failure) return yield* failure.error;
    const materials = result.courseMaterials[0];
    if (!materials) {
        return yield* new ApplicationError({ reason: "cache-miss", message: "講義の教材一覧が見つかりません。" });
    }
    const courses = yield* application.listCourses.execute({ sync: "auto", head: "auto" });
    const course = courses.find((course) => course.availability === "available" && course.lmsCourseId === lmsCourseId);
    return {
        courseName: course?.name ?? "講義",
        folders: materials.folders.map((folder) => ({
            name: folder.name,
            classDate: folder.classDate?.toISOString(),
            materials: folder.materials.map(serializeMaterial),
        })),
    };
}, toDesktopResult);

const viewMaterial = Effect.fn("DesktopInboundAdapter.viewMaterial")(function* (
    materialId: string,
    sync: SyncPolicy,
) {
    const application = yield* Application;
    const detail = yield* application.viewMaterial.execute({
        lmsMaterialId: LmsMaterialId(materialId),
        sync,
        head: "auto",
    });
    return { ...detail, material: serializeMaterial(detail.material) };
}, toDesktopResult);

export const DesktopInboundAdapter = { listCourses, listMaterials, viewMaterial };
