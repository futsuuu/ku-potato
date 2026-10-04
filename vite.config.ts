import type { AddressInfo } from "node:net";
import * as path from "node:path";
import solid from "@solidjs/vite-plugin";
import { fileRoutes } from "filesystem-routing/vite";
import { defineConfig, type Plugin } from "vite";

export default defineConfig({
    plugins: [
        solid({
            start: {
                app: "desktop/client/App.tsx",
            },
        }),
        fileRoutes({
            dir: "desktop/client/routes",
            types: "desktop/client/file-routes.d.ts",
        }),
        denoDesktop({
            server: "desktop/server.ts",
        }),
    ],
});

interface DenoDesktopOptions {
    server: string;
}

function denoDesktop(opts?: Partial<DenoDesktopOptions>): Plugin[] {
    const withDefaults: DenoDesktopOptions = {
        server: opts?.server ?? "server.ts",
    };
    return [denoDesktopDevelopmentPlugin(withDefaults), denoDesktopBuildPlugin(withDefaults)];
}

function denoDesktopDevelopmentPlugin(opts: DenoDesktopOptions): Plugin {
    let child: Deno.ChildProcess | undefined;
    let stopping: Promise<void> | undefined;
    let closed = false;

    const stop = () => {
        closed = true;
        return stopping ??= (async () => {
            const running = child;
            child = undefined;
            if (!running) return;
            await stopDevelopmentDesktop(running);
        })();
    };

    return {
        name: "ku-potato:desktop-dev",
        apply: "serve",
        configureServer(server) {
            const httpServer = server.httpServer;
            if (!httpServer) throw new Error("Desktop requires a Vite HTTP server");
            const start = () => {
                if (closed) return;
                const address = httpServer.address();
                if (!address || typeof address === "string") throw new Error("Vite must listen on a TCP port");
                const webview2UserDataFolder = ".tmp/webview2-user-data";
                const running = spawnDevelopmentDesktop({
                    cwd: server.config.root,
                    devServerUrl: developmentServerUrl(address),
                    webview2UserDataFolder: path.join(server.config.root, webview2UserDataFolder),
                }, opts);
                server.watcher.unwatch(webview2UserDataFolder);
                child = running;
                void running.status.then(async (status) => {
                    if (child !== running || closed) return;
                    child = undefined;
                    if (!status.success) {
                        Deno.exitCode = status.code;
                        server.config.logger.error(`Desktop exited with code ${status.code}`);
                    }
                    await server.close();
                });
            };
            if (httpServer.listening) start();
            else httpServer.once("listening", start);
            httpServer.once("close", () => void stop());
        },
        closeBundle: stop,
    };
}

function denoDesktopBuildPlugin(opts: DenoDesktopOptions): Plugin {
    return {
        name: "ku-potato:desktop-build",
        apply: "build",
        buildApp: {
            order: "post",
            async handler(builder) {
                const client = builder.environments.client;
                if (!client.isBuilt) await builder.build(client);
                const status = await new Deno.Command(Deno.execPath(), {
                    args: [
                        "desktop",
                        "--exclude-unused-npm",
                        "--allow-all",
                        "--unsafe-proto",
                        `--include=./dist/client`,
                        `--include=./sqlite/drizzle`,
                        opts.server,
                    ],
                    cwd: client.config.root,
                    stdin: "null",
                    stdout: "inherit",
                    stderr: "inherit",
                }).spawn().status;
                if (!status.success) this.error(`Desktop packaging failed with code ${status.code}`);
            },
        },
    };
}

function developmentServerUrl(address: AddressInfo): string {
    const hostname = address.address === "0.0.0.0" ? "127.0.0.1" : address.address === "::" ? "::1" : address.address;
    return hostname.includes(":") ? `http://[${hostname}]:${address.port}` : `http://${hostname}:${address.port}`;
}

function spawnDevelopmentDesktop(
    env: {
        cwd: string;
        devServerUrl: string;
        /**
         * Desktop packaging copies the shared backend cache, including any WebView profile stored there.
         * Live profile files are locked on Windows and make that copy fail. Use a separate development profile
         * so packaging can run while the development app is open.
         */
        webview2UserDataFolder: string;
    },
    opts: DenoDesktopOptions,
): Deno.ChildProcess {
    return new Deno.Command(Deno.execPath(), {
        args: [
            "desktop",
            "--hmr",
            "--exclude-unused-npm",
            "--allow-all",
            "--unsafe-proto",
            "--include=./sqlite/drizzle",
            opts.server,
        ],
        cwd: env.cwd,
        env: {
            VITE_DEV_SERVER_URL: env.devServerUrl,
            WEBVIEW2_USER_DATA_FOLDER: env.webview2UserDataFolder,
        },
        stdin: "null",
        stdout: "inherit",
        stderr: "inherit",
        detached: Deno.build.os !== "windows",
    }).spawn();
}

async function stopDevelopmentDesktop(child: Deno.ChildProcess): Promise<void> {
    if (Deno.build.os === "windows") {
        await new Deno.Command("taskkill", {
            args: ["/PID", String(child.pid), "/T", "/F"],
            stdout: "null",
            stderr: "null",
        }).output();
    } else {
        try {
            Deno.kill(-child.pid, "SIGTERM");
        } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
    }
    await child.status;
}
