import { Brand } from "effect";

/** The LMS value used by the HOME page to open a course. */
export type LmsCourseId = string & Brand.Brand<"LmsCourseId">;

/** Constructs an LMS course ID after an adapter has extracted it from the LMS. */
export const LmsCourseId = Brand.nominal<LmsCourseId>();

/** The LMS value used to open a teaching material. */
export type LmsMaterialId = string & Brand.Brand<"LmsMaterialId">;

/** Constructs an LMS material ID after an adapter has extracted it from the LMS. */
export const LmsMaterialId = Brand.nominal<LmsMaterialId>();

/** Stable KU-LMS resource detail (SRS) identity, independent of its filename. */
export type LmsResourceId = string & Brand.Brand<"LmsResourceId">;
export const LmsResourceId = Brand.nominal<LmsResourceId>();

export type SavedResourceFile = {
    readonly uuid: string;
    readonly originalFilename: string;
    readonly sha256: string;
    readonly size: number;
    readonly sourceUrl?: string;
};

export type ResourceAcquisition = {
    readonly lastSucceededAt?: Date;
    readonly lastAttempt: {
        readonly at: Date;
        readonly status: "success" | "failure";
        readonly error?: string;
    };
};

/** A course shown on the LMS home page. */
export type Course =
    | {
        readonly lmsCourseId: LmsCourseId;
        readonly name: string;
        readonly availability: "available";
        readonly archived?: true;
    }
    | {
        readonly name: string;
        readonly availability: "unavailable";
        readonly archived?: true;
    };

/** A course that currently exposes an LMS link. */
export type AvailableCourse = Extract<Course, { readonly availability: "available" }>;

/** A teaching material displayed on a course's teaching-material page. */
export type Material =
    & {
        readonly lmsMaterialId: LmsMaterialId;
        readonly name: string;
        readonly publicationDeadline: Date | "no-deadline" | "unavailable";
        readonly archived?: true;
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
    /** Absent only for snapshots archived before stable IDs were recorded. */
    readonly lmsResourceId?: LmsResourceId;
    readonly type?: "file" | "external" | "unsupported";
    readonly sourceKind?: string;
    readonly url?: string;
    readonly availability?: "current" | "archived";
    readonly savedFile?: SavedResourceFile;
    /** Derived by the application; never stored as an absolute or relative DB path. */
    readonly savedPath?: string;
    readonly acquisition?: ResourceAcquisition;
};

/** The result of retrieving a resource; downloaded files outlive the LMS session. */
export type ResourceDownload =
    | { readonly type: "file"; readonly path: string; readonly originalFilename?: string }
    | { readonly type: "external"; readonly url: string };

/** All resources retrieved for one material. */
export type MaterialResources = {
    readonly lmsMaterialId: LmsMaterialId;
    readonly resources: readonly Resource[];
};

/** Archived information needed to display one globally identified material. */
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
