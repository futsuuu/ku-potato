import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "storybook-solidjs-vite";

export default {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs"],
  framework: {
    name: "storybook-solidjs-vite",
    options: {
      docgen: false,
      builder: {
        viteConfigPath: fileURLToPath(new URL("./vite.config.ts", import.meta.url)),
      },
    },
  },
  core: { disableTelemetry: true },
} satisfies StorybookConfig;
