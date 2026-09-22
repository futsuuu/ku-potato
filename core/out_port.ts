/** Application outbound port, implemented by an infrastructure adapter. */

import type { Course, CourseMaterials } from "ku-potato-domain";
import { type Effect, Schema } from "effect";

export interface CourseMaterialsGateway {
    readonly list: Effect.Effect<readonly CourseMaterials[], CourseMaterialsGatewayError>;
}

/** Retrieves the course index from an external LMS. */
export interface CourseGateway {
    readonly listCourses: Effect.Effect<readonly Course[], CourseMaterialsGatewayError>;
}

/** A failure while obtaining course materials. */
export class CourseMaterialsGatewayError extends Schema.TaggedError<CourseMaterialsGatewayError>()(
    "CourseMaterialsGatewayError",
    {
        operation: Schema.String,
        message: Schema.String,
    },
) {}
