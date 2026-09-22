import { CliInboundAdapter } from "ku-potato-cli";
import { makeListCourseMaterials } from "ku-potato-core";
import { CourseMaterialsGatewayLive } from "ku-potato-playwright";
import { Effect } from "effect";

const listCourseMaterials = makeListCourseMaterials(CourseMaterialsGatewayLive);

if (import.meta.main) {
    await Effect.runPromise(CliInboundAdapter.run(Deno.args, listCourseMaterials));
}
