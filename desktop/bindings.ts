import type { QueryError, SyncPolicy } from "../core/in_port.ts";
import type { AvailableCourse, Course, Material, Resource, ResourceDownload } from "../domain/mod.ts";

export type DesktopQueryResult<A> =
    | { readonly status: "success"; readonly data: A }
    | { readonly status: "error"; readonly error: Pick<QueryError, "reason" | "message"> };

export type DesktopMaterial<M extends Material = Material> = M extends Material
    ? Omit<M, "publicationDeadline"> & { readonly publicationDeadline: string }
    : never;

export type DesktopCourseMaterials = {
    readonly courseName: string;
    readonly folders: readonly {
        readonly name: string;
        readonly classDate?: string;
        readonly materials: readonly DesktopMaterial[];
    }[];
};

export type DesktopMaterialDetail = {
    readonly course: AvailableCourse;
    readonly material: DesktopMaterial;
    readonly resources: readonly Resource[];
};

export type CourseListResult = DesktopQueryResult<readonly Course[]>;
export type CourseMaterialsResult = DesktopQueryResult<DesktopCourseMaterials>;
export type MaterialDetailResult = DesktopQueryResult<DesktopMaterialDetail>;

/** Shared contract for Deno-side handlers and the webview's bindings proxy. */
export interface DesktopBindings {
    listCourses(sync: SyncPolicy): Promise<CourseListResult>;
    listMaterials(courseId: string, sync: SyncPolicy): Promise<CourseMaterialsResult>;
    viewMaterial(materialId: string, sync: SyncPolicy): Promise<MaterialDetailResult>;
    downloadResource(materialId: string, position: number): Promise<DesktopQueryResult<ResourceDownload>>;
}
