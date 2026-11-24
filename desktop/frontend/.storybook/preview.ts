import type { Preview } from "storybook-solidjs-vite";
import "virtual:app-fonts";
import "../src/styles/tokens.css";
import "../src/styles/base.css";
import "../src/styles/app.css";
import "./preview.css";

export default {
  tags: ["autodocs", "!test"],
  parameters: {
    layout: "padded",
    backgrounds: { disable: true },
    controls: { expanded: true },
  },
  beforeAll() {
    document.documentElement.lang = "ja";
  },
} satisfies Preview;
