import { Brand } from "effect";

/** The LMS value used by the HOME page to open a course. */
export type LmsCourseId = string & Brand.Brand<"LmsCourseId">;

/** Constructs an LMS course ID after an adapter has extracted it from the LMS. */
export const LmsCourseId = Brand.nominal<LmsCourseId>();

/** The LMS value used to open a teaching material. */
export type LmsMaterialId = string & Brand.Brand<"LmsMaterialId">;

/** Constructs an LMS material ID after an adapter has extracted it from the LMS. */
export const LmsMaterialId = Brand.nominal<LmsMaterialId>();

/** A course shown on the LMS home page. */
export type Course =
    | {
        readonly lmsCourseId: LmsCourseId;
        readonly name: string;
        readonly availability: "available";
    }
    | {
        readonly name: string;
        readonly availability: "unavailable";
    };

/** A course that currently exposes an LMS link. */
export type AvailableCourse = Extract<Course, { readonly availability: "available" }>;

/** A teaching material displayed on a course's teaching-material page. */
export type Material =
    & {
        readonly lmsMaterialId: LmsMaterialId;
        readonly name: string;
        readonly publicationDeadline: Date | "no-deadline" | "unavailable";
    }
    & ({
        readonly type: "material";
        /** Whether the LMS currently exposes a link to the material's resources. */
        readonly resourceAvailability: "available" | "unavailable";
    } | {
        readonly type: "report" | "test" | "questionnaire" | "e-learning";
    });

/** A folder and every material it contained in one course retrieval. */
export type MaterialFolder = {
    readonly name: string;
    readonly classDate?: Date;
    readonly materials: readonly Material[];
};

/** All folders and materials retrieved for one openable course. */
export type CourseMaterials = {
    readonly lmsCourseId: LmsCourseId;
    readonly folders: readonly MaterialFolder[];
};

/** A resource listed in the detail page for one teaching material. */
export type Resource = {
    readonly name: string;
};

/** All resources retrieved for one material. */
export type MaterialResources = {
    readonly lmsMaterialId: LmsMaterialId;
    readonly resources: readonly Resource[];
};

/** Cached information needed to display one globally identified material. */
export type MaterialDetail = {
    readonly course: AvailableCourse;
    readonly material: Material;
    readonly resources: readonly Resource[];
};

/** A course-material snapshot bundled with its prerequisite course snapshot. */
export type CourseMaterialsSnapshot = {
    readonly courses: readonly Course[];
    readonly courseMaterials: CourseMaterials;
};

/** A resource snapshot bundled with its prerequisite course and material snapshots. */
export type MaterialResourcesSnapshot = {
    readonly courses: readonly Course[];
    readonly courseMaterials: CourseMaterials;
    readonly materialResources: MaterialResources;
};
