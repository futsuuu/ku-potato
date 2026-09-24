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

/** A folder displayed on a course's teaching-material page. */
export type MaterialFolderInfo = {
    readonly name: string;
    readonly classDate?: Date;
};

/** A teaching material obtained from one course page. */
export type CourseMaterial =
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

/** A folder and every material it contained in one retrieval. */
export type CourseMaterialFolder = MaterialFolderInfo & {
    readonly materials: readonly CourseMaterial[];
};

/** All folders and materials retrieved for one openable course. */
export type CourseMaterials = {
    readonly lmsCourseId: LmsCourseId;
    readonly folders: readonly CourseMaterialFolder[];
};

/** A resource listed in the detail page for one teaching material. */
export type MaterialResource = {
    readonly name: string;
};

/** All resources retrieved for one material. */
export type MaterialResources = {
    readonly lmsCourseId: LmsCourseId;
    readonly lmsMaterialId: LmsMaterialId;
    readonly resources: readonly MaterialResource[];
};

/** A material retrieval bundled with the prerequisite course retrieval. */
export type CourseMaterialsRefresh = {
    readonly courses: readonly Course[];
    readonly courseMaterials: CourseMaterials;
};

/** A resource retrieval bundled with its prerequisite course and material retrievals. */
export type MaterialResourcesRefresh = {
    readonly courses: readonly Course[];
    readonly courseMaterials: CourseMaterials;
    readonly materialResources: MaterialResources;
};
