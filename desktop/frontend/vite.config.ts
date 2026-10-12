import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite-plus";
import UnoCSS from "unocss/vite";
import { fileRoutes } from "filesystem-routing/vite";
import { fontAssets } from "./font-assets";

export default defineConfig({
  plugins: [
    UnoCSS(),
    fontAssets(),
    solid({
      start: {
        devtools: false,
      },
    }),
    fileRoutes(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        configure: (proxy) => {
          // The browser uses same-origin requests; the API sees its own origin.
          proxy.on("proxyReq", (request) => request.removeHeader("origin"));
        },
      },
    },
  },
});
