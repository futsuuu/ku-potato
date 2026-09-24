import { CliInboundAdapter } from "ku-potato-cli";
import { makeListCourses, makeSyncCourses } from "ku-potato-core";
import { LmsCacheGateway, LmsSourceGateway } from "ku-potato-core/out_port";
import { LmsSourceGatewayLive } from "ku-potato-playwright";
import { makeLmsCacheGateway } from "ku-potato-sqlite";
import { Effect } from "effect";

const program = Effect.scoped(Effect.gen(function* () {
    const cache = yield* makeLmsCacheGateway();
    return yield* CliInboundAdapter.run(
        Deno.args,
        makeListCourses(),
        makeSyncCourses(),
    ).pipe(
        Effect.provideService(LmsCacheGateway, cache),
        Effect.provideService(LmsSourceGateway, LmsSourceGatewayLive),
    );
}));

if (import.meta.main) {
    await Effect.runPromise(program);
}
