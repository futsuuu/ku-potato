import * as effect from "@effect/tsgo/oxlint-presets";
import unocss from "@unocss/eslint-config/flat";
import { defineConfig } from "oxlint";

export default defineConfig({
    extends: [effect.recommended],
    ignorePatterns: ["/types", "node_modules", "/dist", "/.tmp"],
    jsPlugins: [
        { name: "unocss", specifier: "@unocss/eslint-plugin" },
        { name: "eslint-js", specifier: "oxlint-plugin-eslint" },
    ],
    options: {
        typeAware: true,
        typeCheck: true,
    },
    overrides: [
        {
            files: ["*_test.ts", "vite.config.ts", "desktop/server.ts"],
            rules: { "effecttsgo/async-function": "off" },
        },
        {
            files: ["vite.config.ts"],
            rules: { "effecttsgo/node-builtin-import": "off" },
        },
        {
            files: ["desktop/client/**/*.{ts,tsx}"],
            rules: {
                ...unocss.rules,
                "unocss/order": "error",
                "unocss/blocklist": "error",
                "eslint-js/no-restricted-syntax": [
                    "error",
                    {
                        selector: "JSXAttribute[name.name=/^(class|className)$/] > JSXExpressionContainer",
                        message: "Use a static class string so UnoCSS's blocklist can validate every utility.",
                    },
                    {
                        selector:
                            "JSXAttribute[name.name=/^(style|classList)$/], JSXAttribute[name.namespace.name='style'], JSXOpeningElement[name.name='style']",
                        message: "Use theme classes; define shared styles in uno.config.ts.",
                    },
                ],
                "no-restricted-imports": ["error", {
                    patterns: [{
                        group: ["**/*.css", "**/*.scss", "**/*.sass", "**/*.less", "!virtual:uno.css"],
                        message: "Define shared styles in uno.config.ts using theme tokens.",
                    }],
                }],
            },
        },
    ],
});
