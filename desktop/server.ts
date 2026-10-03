import { serveDir, serveFile } from "@std/http/file-server";
import { fileURLToPath } from "node:url";
import type { DesktopBindings } from "./bindings.ts";

// The first BrowserWindow adopts the window created by `deno desktop`.
const win = new Deno.BrowserWindow<DesktopBindings>({ title: "KU-POTATO" });
win.bind("greet", (name) => Promise.resolve(`Hello, ${name}! From Deno ${Deno.version.deno}.`));

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
