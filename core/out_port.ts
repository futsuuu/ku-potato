/** Application outbound port, implemented by an infrastructure adapter. */

import type { CourseMaterials } from "ku-potato-domain";
import { type Effect, Schema } from "effect";

export interface CourseMaterialsGateway {
    readonly list: Effect.Effect<readonly CourseMaterials[], CourseMaterialsGatewayError>;
}

/** A failure while obtaining course materials. */
export class CourseMaterialsGatewayError extends Schema.TaggedError<CourseMaterialsGatewayError>()(
    "CourseMaterialsGatewayError",
    {
        operation: Schema.String,
        message: Schema.String,
    },
) {}
