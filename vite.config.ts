import { defineConfig } from "vite-plus";
import solidLint from "eslint-plugin-solid/configs/v2";

export default defineConfig({
  run: {
    tasks: {
      "proto:generate": {
        command: "go run ./tools/proto-codegen",
        cache: false,
      },
      "proto:check": {
        command: "clang-format --dry-run --Werror browser-worker/protocol/worker.proto",
        cache: false,
      },
      "worker:build": {
        command: "go build -o ./desktop/build/bin/ ./browser-worker/cmd/ku-potato-browser-worker",
        cache: {
          input: ["browser-worker/**/*", "internal/**/*", "go.mod", "go.sum"],
          output: ["desktop/build/bin/ku-potato-browser-worker*"],
          env: ["GOOS", "GOARCH", "CGO_ENABLED", "GOTOOLCHAIN"],
        },
      },
      "server:dev": {
        command:
          "go run ./app-server/cmd/ku-potato-server -worker ./desktop/build/bin/ku-potato-browser-worker",
        dependsOn: ["worker:build"],
        cache: false,
      },
      "server:build": {
        command: "go build -o ./desktop/build/bin/ ./app-server/cmd/ku-potato-server",
        dependsOn: ["worker:build"],
        cache: {
          input: [
            "app-server/**/*",
            "browser-worker/**/*",
            "internal/**/*",
            "go.mod",
            "go.sum",
            "mise.toml",
          ],
          output: ["desktop/build/bin/ku-potato-server*"],
          env: ["GOOS", "GOARCH", "CGO_ENABLED", "GOTOOLCHAIN"],
        },
      },
      "frontend:install": {
        command: "vp install --frozen-lockfile",
        cache: false,
      },
      "openapi:generate": {
        command:
          "go run ./app-server/cmd/ku-potato-server openapi -out tools/api-codegen/openapi.generated.json",
        cache: {
          input: ["app-server/**/*", "internal/**/*", "go.mod", "go.sum", "mise.toml"],
          output: ["tools/api-codegen/openapi.generated.json"],
          env: ["GOOS", "GOARCH", "CGO_ENABLED", "GOTOOLCHAIN"],
        },
      },
      "api:generate": {
        command: "node generate.mjs openapi.generated.json",
        cwd: "tools/api-codegen",
        dependsOn: ["frontend:install", "openapi:generate"],
      },
      "db:generate": {
        command: "go run ./tools/db-codegen",
        cache: false,
      },
      "db:check": {
        command: "go run ./tools/db-codegen -check",
        cache: {
          input: [
            "tools/db-codegen/**/*",
            "app-server/sqlite/schema/**/*",
            "app-server/sqlite/gen/**/*",
            "go.mod",
            "go.sum",
            "mise.toml",
          ],
          output: [],
          env: ["GOOS", "GOARCH", "CGO_ENABLED", "GOTOOLCHAIN"],
        },
      },
      dev: {
        command: "node tools/wails.mjs dev",
        dependsOn: ["server:build", "frontend:install"],
        cache: false,
      },
      build: {
        command: "node tools/wails.mjs build",
        dependsOn: ["server:build"],
        cache: false,
      },
      test: {
        command:
          "go test -count=1 ./app-server/... ./browser-worker/... ./internal/... ./desktop/...",
        dependsOn: ["frontend:build", "frontend:test"],
        cache: false,
      },
      "server:browser-test": {
        command: "go test ./browser-worker/browser/tests -count=1 -v",
        cache: false,
      },
      check: {
        command: [
          "vp check",
          "golangci-lint fmt --diff",
          "go vet ./app-server/... ./browser-worker/... ./internal/... ./desktop/... ./tools/...",
        ],
        dependsOn: ["frontend:build", "db:check", "proto:check"],
        cache: false,
      },
      format: {
        command: [
          "vp fmt",
          "golangci-lint fmt",
          "clang-format -i browser-worker/protocol/worker.proto",
        ],
        cache: false,
      },
      "desktop:bindings": {
        command: "go tool wails3 generate bindings -ts -d frontend/bindings .",
        cwd: "desktop",
        cache: false,
      },
      "frontend:build": {
        command: "vp build",
        cwd: "desktop/frontend",
        dependsOn: ["api:generate", "desktop:bindings"],
      },
      "frontend:test": {
        command: "vp test run",
        cwd: "desktop/frontend",
        dependsOn: ["desktop:bindings"],
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
    ignorePatterns: ["**/api.generated.ts", "**/bindings/**", "**/dist/**"],
  },
  fmt: {
    ignorePatterns: ["**/*.md", "**/bindings/**", "**/dist/**"],
  },
});
