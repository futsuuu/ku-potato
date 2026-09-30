import { DenoTerminal } from "@effect/platform-deno";
import { ApplicationLive } from "ku-potato-core";
import { LmsAuthenticationGateway, LmsSourceGateway } from "ku-potato-core/out_port";
import { makeLmsGateways } from "ku-potato-playwright";
import { makeLmsCacheGatewayLayer } from "ku-potato-sqlite";
import { Effect, Layer } from "effect";
import { CliInboundAdapter } from "./mod.ts";

const program = Effect.gen(function* () {
    const gateways = makeLmsGateways();
    const outbound = Layer.mergeAll(
        Layer.succeed(LmsAuthenticationGateway, gateways.authentication),
        Layer.succeed(LmsSourceGateway, gateways.source),
        makeLmsCacheGatewayLayer(),
    );
    const application = ApplicationLive.pipe(Layer.provide(outbound));
    return yield* CliInboundAdapter.run(Deno.args).pipe(
        Effect.provide(Layer.merge(application, DenoTerminal.layer)),
    );
});

if (import.meta.main) {
    Deno.exitCode = await Effect.runPromise(program);
}
