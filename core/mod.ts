import type { ListCourseMaterials, ListCourses } from "./in_port.ts";
import type { CourseGateway, CourseMaterialsGateway } from "./out_port.ts";

/** Creates the application input port with a concrete output-port implementation. */
export function makeListCourseMaterials(gateway: CourseMaterialsGateway): ListCourseMaterials {
    return {
        execute: gateway.list,
    };
}

/** Creates the primitive course-index input port. */
export function makeListCourses(gateway: CourseGateway): ListCourses {
    return {
        execute: gateway.listCourses,
    };
}
