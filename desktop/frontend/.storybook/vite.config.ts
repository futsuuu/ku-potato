import { fileURLToPath } from "node:url";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite-plus";
import { fontAssets } from "../font-assets";

export default defineConfig({
  plugins: [fontAssets(), solid()],
  resolve: {
    alias: [
      {
        find: /^(?:\.{1,2}\/)+native$/,
        replacement: fileURLToPath(new URL("./native.ts", import.meta.url)),
      },
    ],
  },
  build: { assetsInlineLimit: 0 },
});
