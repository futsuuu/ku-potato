import { defineConfig } from "vite-plus";
import solidLint from "eslint-plugin-solid/configs/v2";

export default defineConfig({
  run: {
    tasks: {
      "app-server:api:docs": {
        command:
          "node tools/openapi-docs/generate.ts tools/api-codegen/openapi.generated.json docs/app-server-api",
        dependsOn: ["app-server:api:generate"],
      },
      "app-server:api:generate":
        "cargo run --locked --bin ku-potato-server -- openapi --out tools/api-codegen/openapi.generated.json",
      "app-server:build": "node tools/build-server.mjs",
      "app-server:db:check": {
        command: [],
        dependsOn: ["app-server:db:entities:check", "tools:db-docs:test"],
      },
      "app-server:db:entities:check": "node tools/generate-entities.mjs --check",
      "app-server:db:generate": "node tools/generate-entities.mjs",
      "app-server:db:docs": "go run ./tools/db-docs",
      "app-server:dev": {
        command:
          "cargo run --locked --bin ku-potato-server -- --worker ./desktop/build/bin/ku-potato-browser-worker --user-browser ./desktop/build/bin/ku-potato-user-browser",
        dependsOn: ["browser-worker:build", "user-browser:build"],
        cache: false,
      },
      "browser-worker:browser:test": "go test ./browser-worker/browser/tests -count=1 -v",
      "browser-worker:build":
        "go build -o ./desktop/build/bin/ ./browser-worker/cmd/ku-potato-browser-worker",
      "browser-worker:proto:generate": "go run ./tools/proto-codegen",
      build: {
        command: "WAILS_EXP_USE_WAKE=1 go tool wails3 build",
        cache: false,
        dependsOn: [
          "app-server:build",
          "browser-worker:build",
          "desktop:frontend:build",
          "user-browser:build",
        ],
      },
      check: {
        command: [],
        dependsOn: [
          "app-server:db:check",
          "check:go",
          "check:js",
          "check:rust",
          "format:go:check",
          "format:js:check",
          "format:proto:check",
          "format:rust:check",
        ],
      },
      "check:go": {
        command: "golangci-lint run ./...",
        dependsOn: ["desktop:frontend:build"],
      },
      "check:js": {
        command: "vp check --no-fmt",
        dependsOn: ["desktop:frontend:api:generate", "desktop:bindings:generate"],
      },
      "check:rust": "cargo clippy --locked --workspace --all-targets -- -D warnings",
      "desktop:bindings:generate": {
        command: "go tool wails3 generate bindings -ts -d frontend/bindings .",
        cwd: "desktop",
      },
      "desktop:frontend:api:generate": {
        command: "node generate.mjs openapi.generated.json",
        cwd: "tools/api-codegen",
        dependsOn: ["app-server:api:generate"],
      },
      "desktop:frontend:build": {
        command: [],
        dependsOn: ["desktop:frontend:bundle", "desktop:frontend:typecheck"],
      },
      "desktop:frontend:bundle": {
        command: "vp build",
        cwd: "desktop/frontend",
        dependsOn: ["desktop:frontend:api:generate", "desktop:bindings:generate"],
      },
      "desktop:frontend:test": {
        command: "vp test run",
        cwd: "desktop/frontend",
        dependsOn: ["desktop:bindings:generate"],
      },
      "desktop:frontend:typecheck": {
        command: "tsc --noEmit",
        cwd: "desktop/frontend",
        dependsOn: ["desktop:frontend:api:generate", "desktop:bindings:generate"],
      },
      dev: {
        command: "WAILS_EXP_USE_WAKE=1 go tool wails3 dev",
        dependsOn: ["app-server:build", "browser-worker:build", "user-browser:build"],
        cache: false,
      },
      format: {
        command: [],
        dependsOn: ["format:go", "format:js", "format:proto", "format:rust"],
      },
      "format:go": {
        command: "golangci-lint fmt",
        cache: false,
      },
      "format:go:check": "golangci-lint fmt --diff",
      "format:js": {
        command: "vp fmt",
        cache: false,
      },
      "format:js:check": "vp fmt --check",
      "format:proto": {
        command:
          "clang-format -i browser-worker/protocol/worker.proto user-browser/protocol/user_browser.proto",
        cache: false,
      },
      "format:proto:check":
        "clang-format --dry-run --Werror browser-worker/protocol/worker.proto user-browser/protocol/user_browser.proto",
      "format:rust": {
        command: "cargo fmt --all",
        cache: false,
      },
      "format:rust:check": "cargo fmt --all --check",
      "telemetry-view": {
        command: "go run ./tools/telemetry-view",
        cache: false,
      },
      test: {
        command: [],
        dependsOn: ["desktop:frontend:test", "test:go", "test:rust", "tools:openapi-docs:test"],
      },
      "test:go": {
        command:
          "go test -count=1 ./browser-worker/... ./user-browser/... ./internal/... ./desktop/...",
        dependsOn: ["desktop:frontend:build"],
      },
      "test:rust": "cargo test --locked --workspace",
      "tools:db-docs:test": "go test ./tools/db-docs",
      "tools:openapi-docs:test": {
        command: "vp test run",
        cwd: "tools/openapi-docs",
      },
      "user-browser:browser:test": "go test ./user-browser/browser/... -count=1 -v",
      "user-browser:build":
        "go build -o ./desktop/build/bin/ ./user-browser/cmd/ku-potato-user-browser",
      "user-browser:proto:generate": "go run ./tools/proto-codegen",
    },
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
    jsPlugins: ["eslint-plugin-solid"],
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
        },
      },
    ],
    ignorePatterns: ["**/api.generated.ts", "**/bindings/**", "**/dist/**"],
  },
  fmt: {
    ignorePatterns: ["**/*.md", "**/bindings/**", "**/dist/**"],
  },
});
