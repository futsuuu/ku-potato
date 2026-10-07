import { DenoTerminal } from "@effect/platform-deno";
import { ApplicationLive } from "../core/mod.ts";
import { LmsAuthenticationGateway, LmsSourceGateway } from "../core/out_port.ts";
import { makeLmsGateways } from "../playwright/mod.ts";
import { makeLmsArchiveGatewayLayer } from "../sqlite/mod.ts";
import { makeResourceFileGatewayLayer } from "../filesystem/mod.ts";
import { Effect, Layer } from "effect";
import { CliInboundAdapter } from "./mod.ts";

const program = Effect.gen(function* () {
    const gateways = makeLmsGateways();
    const outbound = Layer.mergeAll(
        Layer.succeed(LmsAuthenticationGateway, gateways.authentication),
        Layer.succeed(LmsSourceGateway, gateways.source),
        makeLmsArchiveGatewayLayer(),
        makeResourceFileGatewayLayer(),
    );
    const application = ApplicationLive.pipe(Layer.provide(outbound));
    return yield* CliInboundAdapter.run(Deno.args).pipe(
        Effect.provide(Layer.merge(application, DenoTerminal.layer)),
    );
});

if (import.meta.main) {
    Deno.exitCode = await Effect.runPromise(program);
}
