import { Effect } from "effect";
import { type CourseMaterialsJobDefinition, LmsSourceGateway } from "./out_port.ts";
import type { JobHandlers } from "./worker.ts";

/** Fetch directly; invoking listMaterials here would enqueue another job and deadlock. */
export const courseMaterialsJobHandlers = Effect.gen(function* () {
    const source = yield* LmsSourceGateway;
    return {
        "fetch-course-materials": {
            execute: (input) =>
                source.withSession(input.head, (session) => session.fetchCourseMaterials(input.lmsCourseId)).pipe(
                    Effect.mapError((error) => ({
                        message: error.message,
                        tag: error._tag,
                        retry: error._tag === "LmsSourceGatewayError",
                        blocked: error._tag === "LmsAuthenticationRequiredError",
                    })),
                ),
        },
    } satisfies JobHandlers<CourseMaterialsJobDefinition>;
});
