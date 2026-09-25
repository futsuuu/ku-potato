import { CliInboundAdapter } from "ku-potato-cli";
import {
    makeGetAuthenticationStatus,
    makeListCourses,
    makeListMaterials,
    makeLogin,
    makeLogout,
    makeViewMaterial,
} from "ku-potato-core";
import { LmsAuthenticationGateway, LmsCacheGateway, LmsSourceGateway } from "ku-potato-core/out_port";
import { LmsAuthenticationGatewayLive, LmsSourceGatewayLive } from "ku-potato-playwright";
import { makeLazyLmsCacheGateway } from "ku-potato-sqlite";
import { Effect } from "effect";

const program = Effect.scoped(Effect.gen(function* () {
    const cache = yield* makeLazyLmsCacheGateway();
    return yield* CliInboundAdapter.run(
        Deno.args,
        makeLogin(),
        makeLogout(),
        makeGetAuthenticationStatus(),
        makeListCourses(),
        makeListMaterials(),
        makeViewMaterial(),
    ).pipe(
        Effect.provideService(LmsAuthenticationGateway, LmsAuthenticationGatewayLive),
        Effect.provideService(LmsCacheGateway, cache),
        Effect.provideService(LmsSourceGateway, LmsSourceGatewayLive),
    );
}));

if (import.meta.main) {
    Deno.exitCode = await Effect.runPromise(program);
}
