import { Brand } from "effect";

/** The LMS value used by the HOME page to open a course. */
export type LmsCourseId = string & Brand.Brand<"LmsCourseId">;

/** Constructs an LMS course ID after an adapter has extracted it from the LMS. */
export const LmsCourseId = Brand.nominal<LmsCourseId>();

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

/** A teaching material published for a course. */
export type Material =
    & {
        readonly name: string;
        readonly publicationDeadline: Date | "no-deadline" | "unavailable";
    }
    & ({
        readonly type: "material";
        /** `null` means the LMS has not published a resource link yet. */
        readonly resourceNames: readonly string[] | null;
    } | {
        readonly type: "report" | "test" | "questionnaire" | "e-learning";
    });

export type MaterialFolder = {
    readonly name: string;
    readonly classDate?: Date;
    readonly materials: readonly Material[];
};

/** Course information that can be displayed without knowing where it came from. */
export type AvailableCourseMaterials = {
    readonly name: string;
    readonly availability: "available";
    /** `null` when the course overview does not provide one. */
    readonly courseCode: string | null;
    /** `null` when it cannot be inferred from the overview or folders. */
    readonly year: number | null;
    readonly folders: readonly MaterialFolder[];
};

/** A course can be shown on HOME without being available to open. */
export type CourseMaterials =
    | AvailableCourseMaterials
    | {
        readonly name: string;
        readonly availability: "unavailable";
    };
