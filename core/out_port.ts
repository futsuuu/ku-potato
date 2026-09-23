/** Application outbound port, implemented by an infrastructure adapter. */

import type {
    Course,
    CourseMaterial,
    CourseMaterials,
    LmsCourseId,
    LmsMaterialId,
    MaterialResource,
} from "ku-potato-domain";
import { type Effect, Schema } from "effect";

export interface CourseMaterialsGateway {
    readonly list: Effect.Effect<readonly CourseMaterials[], CourseMaterialsGatewayError>;
}

/** Retrieves the course index from an external LMS. */
export interface CourseGateway {
    readonly listCourses: Effect.Effect<readonly Course[], CourseMaterialsGatewayError>;
}

/** Retrieves materials and their resources from a selected LMS course. */
export interface CourseMaterialGateway {
    /** Lists every material in a course, with its containing folder's display information. */
    readonly listMaterials: (
        lmsCourseId: LmsCourseId,
    ) => Effect.Effect<readonly CourseMaterial[], CourseMaterialsGatewayError>;
    /**
     * Lists resources for one material in a course.
     *
     * The course ID is retained because the LMS opens a material detail page
     * from its course page rather than through a standalone material URL.
     */
    readonly listMaterialResources: (
        lmsCourseId: LmsCourseId,
        lmsMaterialId: LmsMaterialId,
    ) => Effect.Effect<readonly MaterialResource[], CourseMaterialsGatewayError>;
}

/** A failure while obtaining course materials. */
export class CourseMaterialsGatewayError extends Schema.TaggedError<CourseMaterialsGatewayError>()(
    "CourseMaterialsGatewayError",
    {
        operation: Schema.String,
        message: Schema.String,
    },
) {}
