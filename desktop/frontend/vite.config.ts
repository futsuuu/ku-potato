import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite-plus";
import UnoCSS from "unocss/vite";

export default defineConfig({
  plugins: [
    UnoCSS(),
    solid({
      start: {
        devtools: false,
      },
    }),
  ],
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
