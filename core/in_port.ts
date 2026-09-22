/** Application inbound ports, implemented by the application layer. */

import type { CourseMaterials } from "@futsuuu/ku-potato-domain";
import type { Effect } from "effect";
import type { CourseMaterialsGatewayError } from "./out_port.ts";

export interface ListCourseMaterials {
    readonly execute: Effect.Effect<readonly CourseMaterials[], CourseMaterialsGatewayError>;
}
