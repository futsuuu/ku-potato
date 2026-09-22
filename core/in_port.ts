/** Application inbound ports, implemented by the application layer. */

import type { Course, CourseMaterials } from "ku-potato-domain";
import type { Effect } from "effect";
import type { CourseMaterialsGatewayError } from "./out_port.ts";

export interface ListCourseMaterials {
    readonly execute: Effect.Effect<readonly CourseMaterials[], CourseMaterialsGatewayError>;
}

/** Lists the courses visible on the LMS home page without opening a course. */
export interface ListCourses {
    readonly execute: Effect.Effect<readonly Course[], CourseMaterialsGatewayError>;
}
