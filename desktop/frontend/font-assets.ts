import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Plugin } from "vite-plus";

// CSS imports live in a virtual module: application styles stay governed by UnoCSS.
export function fontAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const license = readFileSync(require.resolve("gen-interface-jp/OFL.txt"));
  const licensePath = "/licenses/gen-interface-jp/OFL.txt";
  return {
    name: "app-font-assets",
    resolveId(id) {
      if (id === "virtual:app-fonts") return "\0virtual:app-fonts";
    },
    load(id) {
      if (id === "\0virtual:app-fonts") {
        return 'import "gen-interface-jp/400.css"; import "gen-interface-jp/700.css";';
      }
    },
    configureServer(server) {
      server.middlewares.use(licensePath, (_request, response) => {
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end(license);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: licensePath.slice(1), source: license });
    },
  };
}
