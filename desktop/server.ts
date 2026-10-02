import { serveDir, serveFile } from "@std/http/file-server";
import { fileURLToPath } from "node:url";

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
