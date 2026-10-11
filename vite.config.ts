import { defineConfig } from "vite-plus";
import solidLint from "eslint-plugin-solid/configs/v2";

export default defineConfig({
  run: {
    tasks: {
      "server:dev": {
        command: "go run ./server/cmd/ku-potato-server",
        cache: false,
      },
      "server:build": {
        command: "go build -o ./desktop/build/bin/ ./server/cmd/ku-potato-server",
        cache: false,
      },
      "frontend:install": {
        command: "vp install --frozen-lockfile",
        cache: false,
      },
      "api:generate": {
        command: "vp run @ku-potato/api-codegen#generate",
        dependsOn: ["frontend:install"],
        cache: false,
      },
      "db:generate": {
        command: "go run ./tools/db-codegen",
        cache: false,
      },
      "db:check": {
        command: "go run ./tools/db-codegen -check",
        cache: false,
      },
      dev: {
        command: "go tool wails dev",
        cwd: "desktop",
        dependsOn: ["server:build", "frontend:build"],
        cache: false,
      },
      build: {
        command: "go tool wails build",
        cwd: "desktop",
        dependsOn: ["server:build"],
        cache: false,
      },
      test: {
        command: "go test -count=1 ./server/... ./desktop/...",
        dependsOn: ["frontend:build", "frontend:test"],
        cache: false,
      },
      "server:live-test": {
        command: "go test ./server/chromedp/tests -run TestLiveOperations -count=1 -v",
        cache: false,
      },
      check: {
        command: ["vp check", "go vet ./server/... ./desktop/... ./tools/..."],
        dependsOn: ["frontend:build", "db:check"],
        cache: false,
      },
      format: {
        command: ["vp fmt", "go fmt ./server/... ./desktop/... ./tools/..."],
        cache: false,
      },
      "frontend:build": {
        command: "vp build",
        cwd: "desktop/frontend",
        dependsOn: ["api:generate"],
      },
      "frontend:test": {
        command: "vp test run",
        cwd: "desktop/frontend",
      },
    },
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
    jsPlugins: [
      "eslint-plugin-solid",
      { name: "unocss", specifier: "@unocss/eslint-plugin" },
      { name: "eslint-js", specifier: "oxlint-plugin-eslint" },
    ],
    settings: solidLint.settings,
    rules: {
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/await-thenable": "error",
    },
    overrides: [
      {
        files: ["desktop/frontend/src/**/*.{ts,tsx}"],
        rules: {
          ...solidLint.rules,
          "unocss/order": "error",
          "unocss/blocklist": "error",
          "eslint-js/no-restricted-syntax": [
            "error",
            {
              selector: "JSXAttribute[name.name=/^(class|className)$/] > JSXExpressionContainer",
              message: "Use static class strings so UnoCSS can validate every utility.",
            },
            {
              selector:
                "JSXAttribute[name.name=/^(style|classList)$/], JSXAttribute[name.namespace.name='style'], JSXOpeningElement[name.name='style']",
              message: "Use theme classes; define shared styles in uno.config.ts.",
            },
          ],
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["**/*.css", "**/*.scss", "**/*.sass", "**/*.less", "!virtual:uno.css"],
                  message: "Define shared styles in uno.config.ts using theme tokens.",
                },
              ],
            },
          ],
        },
      },
    ],
    ignorePatterns: ["**/api.generated.ts", "**/dist/**"],
  },
  fmt: {
    ignorePatterns: ["**/*.md", "**/dist/**"],
  },
});
