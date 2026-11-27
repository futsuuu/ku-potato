import { fileURLToPath } from "node:url";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite-plus";
import { FlatFileSystemRouter } from "filesystem-routing";
import { fileRoutes } from "filesystem-routing/vite";
import { fontAssets } from "../font-assets";

export default defineConfig({
  plugins: [
    fontAssets(),
    solid(),
    fileRoutes({
      router: new FlatFileSystemRouter({
        dir: fileURLToPath(new URL("../src/routes", import.meta.url)),
        extensions: ["ts", "tsx"],
      }),
    }),
  ],
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
