import type { ListCourseMaterials } from "./in_port.ts";
import type { CourseMaterialsGateway } from "./out_port.ts";

/** Creates the application input port with a concrete output-port implementation. */
export function makeListCourseMaterials(gateway: CourseMaterialsGateway): ListCourseMaterials {
    return {
        execute: gateway.list,
    };
}
