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
        readonly materials: readonly (DesktopMaterial & { readonly canViewResources: boolean })[];
    }[];
};

export type DesktopMaterialDetail = {
    readonly course: AvailableCourse;
    readonly material: DesktopMaterial;
    readonly resources: readonly DesktopResource[];
};

export type DesktopResource = Omit<Resource, "acquisition"> & {
    readonly acquisition?: {
        readonly lastSucceededAt?: string;
        readonly lastAttempt: { readonly at: string; readonly status: "success" | "failure"; readonly error?: string };
    };
};

export type CourseListResult = DesktopQueryResult<readonly Course[]>;
export type CourseMaterialsResult = DesktopQueryResult<DesktopCourseMaterials>;
export type MaterialDetailResult = DesktopQueryResult<DesktopMaterialDetail>;

export type DesktopAssignment = {
    readonly lmsCourseId: string;
    readonly folderName: string;
    readonly material: DesktopMaterial;
};

export type DesktopAssignments = {
    readonly assignments: readonly DesktopAssignment[];
    readonly failures: readonly {
        readonly lmsCourseId: string;
        readonly error: Pick<QueryError, "reason" | "message">;
    }[];
};

export type AssignmentsResult = DesktopQueryResult<DesktopAssignments>;

/** Shared contract for Deno-side handlers and the webview's bindings proxy. */
export interface DesktopBindings {
    listCourses(sync: SyncPolicy): Promise<CourseListResult>;
    listAssignments(courseIds: readonly string[], sync: SyncPolicy): Promise<AssignmentsResult>;
    listMaterials(courseId: string, sync: SyncPolicy): Promise<CourseMaterialsResult>;
    viewMaterial(materialId: string, sync: SyncPolicy): Promise<MaterialDetailResult>;
    downloadResource(
        materialId: string,
        position: number,
        resourceId?: string,
    ): Promise<DesktopQueryResult<ResourceDownload>>;
}
