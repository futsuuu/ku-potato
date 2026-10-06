import { serveDir, serveFile } from "@std/http/file-server";
import { Layer, ManagedRuntime } from "effect";
import { fileURLToPath } from "node:url";
import { ApplicationLive } from "../core/mod.ts";
import { LmsAuthenticationGateway, LmsSourceGateway } from "../core/out_port.ts";
import { makeLmsGateways } from "../playwright/mod.ts";
import { makeLmsCacheGatewayLayer } from "../sqlite/mod.ts";
import type { DesktopBindings } from "./bindings.ts";
import { DesktopInboundAdapter } from "./mod.ts";

const gateways = makeLmsGateways();
const outbound = Layer.mergeAll(
    Layer.succeed(LmsAuthenticationGateway, gateways.authentication),
    Layer.succeed(LmsSourceGateway, gateways.source),
    makeLmsCacheGatewayLayer(),
);
const runtime = ManagedRuntime.make(ApplicationLive.pipe(Layer.provide(outbound)));

// The first BrowserWindow adopts the window created by `deno desktop`.
const win = new Deno.BrowserWindow<DesktopBindings>({ title: "KU-POTATO" });
win.bind("listCourses", (sync) => runtime.runPromise(DesktopInboundAdapter.listCourses(sync)));
win.bind("listMaterials", (courseId, sync) => runtime.runPromise(DesktopInboundAdapter.listMaterials(courseId, sync)));
win.bind(
    "viewMaterial",
    (materialId, sync) => runtime.runPromise(DesktopInboundAdapter.viewMaterial(materialId, sync)),
);
win.bind(
    "downloadResource",
    (materialId, position) => runtime.runPromise(DesktopInboundAdapter.downloadResource(materialId, position)),
);
win.addEventListener("close", () => void runtime.dispose());

const devServerUrl = Deno.env.get("VITE_DEV_SERVER_URL");
if (devServerUrl) {
    Deno.serve((request) => {
        const url = new URL(request.url);
        const destination = new URL(devServerUrl);
        destination.pathname = url.pathname;
        destination.search = url.search;
        return Response.redirect(destination);
    });
} else {
    const fsRoot = fileURLToPath(new URL("../dist/client/", import.meta.url));
    Deno.serve(async (request) => {
        const response = await serveDir(request, { fsRoot, quiet: true });
        if (
            response.status === 404 &&
            (request.method === "GET" || request.method === "HEAD") &&
            request.headers.get("accept")?.includes("text/html")
        ) {
            await response.body?.cancel();
            return serveFile(request, `${fsRoot}/index.html`);
        }
        return response;
    });
}
