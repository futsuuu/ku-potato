import { CliInboundAdapter } from "@futsuuu/ku-potato-cli";
import { makeListCourseMaterials } from "@futsuuu/ku-potato-core";
import { CourseMaterialsGatewayLive } from "@futsuuu/ku-potato-playwright";
import { Effect } from "effect";

const listCourseMaterials = makeListCourseMaterials(CourseMaterialsGatewayLive);

if (import.meta.main) {
    await Effect.runPromise(CliInboundAdapter.run(Deno.args, listCourseMaterials));
}
