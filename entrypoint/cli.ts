import { CliInboundAdapter } from "ku-potato-cli";
import { makeListCourseMaterials, makeListCourses } from "ku-potato-core";
import { CourseGatewayLive, CourseMaterialsGatewayLive } from "ku-potato-playwright";
import { Effect } from "effect";

const listCourseMaterials = makeListCourseMaterials(CourseMaterialsGatewayLive);
const listCourses = makeListCourses(CourseGatewayLive);

if (import.meta.main) {
    await Effect.runPromise(CliInboundAdapter.run(Deno.args, listCourseMaterials, listCourses));
}
