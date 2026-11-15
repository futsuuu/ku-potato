import { defineConfig } from "vite-plus";
import solidLint from "eslint-plugin-solid/configs/v2";

export default defineConfig({
  run: {
    tasks: {
      "app-server:api:docs": {
        command:
          "node tools/openapi-docs/generate.ts tools/api-codegen/openapi.generated.json docs/app-server-api",
        dependsOn: ["app-server:api:generate"],
        cache: false,
      },
      "app-server:api:generate": {
        command:
          "cargo run --locked --bin ku-potato-server -- openapi --out tools/api-codegen/openapi.generated.json",
        cache: {
          input: ["app-server/**/*", "Cargo.toml", "Cargo.lock", "rust-toolchain.toml"],
          output: ["tools/api-codegen/openapi.generated.json"],
          env: ["CARGO_BUILD_TARGET", "RUSTFLAGS"],
        },
      },
      "app-server:build": {
        command: "node tools/build-server.mjs",
        dependsOn: ["browser-worker:build", "user-browser:build"],
        cache: {
          input: [
            "app-server/**/*",
            "Cargo.toml",
            "Cargo.lock",
            "rust-toolchain.toml",
            "tools/build-server.mjs",
            "browser-worker/**/*",
            "user-browser/**/*",
            "internal/**/*",
            "go.mod",
            "go.sum",
            "mise.toml",
          ],
          output: ["desktop/build/bin/ku-potato-server*"],
          env: ["GOOS", "GOARCH", "CGO_ENABLED", "GOTOOLCHAIN", "CARGO_BUILD_TARGET", "RUSTFLAGS"],
        },
      },
      "app-server:db:check": {
        command: [
          "node tools/generate-entities.mjs --check",
          "cargo test --locked --lib archive::",
          "go test ./tools/db-docs",
        ],
        cache: false,
      },
      "app-server:db:generate": {
        command: "node tools/generate-entities.mjs",
        cache: false,
      },
      "app-server:db:docs": {
        command: "go run ./tools/db-docs",
        cache: false,
      },
      "app-server:dev": {
        command:
          "cargo run --locked --bin ku-potato-server -- --worker ./desktop/build/bin/ku-potato-browser-worker --user-browser ./desktop/build/bin/ku-potato-user-browser",
        dependsOn: ["browser-worker:build", "user-browser:build"],
        cache: false,
      },
      "browser-worker:browser:test": {
        command: "go test ./browser-worker/browser/tests -count=1 -v",
        cache: false,
      },
      "browser-worker:build": {
        command: "go build -o ./desktop/build/bin/ ./browser-worker/cmd/ku-potato-browser-worker",
        cache: {
          input: ["browser-worker/**/*", "internal/**/*", "go.mod", "go.sum"],
          output: ["desktop/build/bin/ku-potato-browser-worker*"],
          env: ["GOOS", "GOARCH", "CGO_ENABLED", "GOTOOLCHAIN"],
        },
      },
      "browser-worker:proto:check": {
        command: "clang-format --dry-run --Werror browser-worker/protocol/worker.proto",
        cache: false,
      },
      "browser-worker:proto:generate": {
        command: "go run ./tools/proto-codegen",
        cache: false,
      },
      build: {
        command: "node tools/wails.mjs build",
        dependsOn: ["app-server:build"],
        cache: false,
      },
      check: {
        command: [
          "vp check",
          "cargo fmt --all --check",
          "cargo clippy --locked --workspace --all-targets -- -D warnings",
          "golangci-lint fmt --diff",
          "golangci-lint run ./...",
        ],
        dependsOn: [
          "desktop:frontend:build",
          "app-server:db:check",
          "browser-worker:proto:check",
          "user-browser:proto:check",
        ],
        cache: false,
      },
      "desktop:bindings:generate": {
        command: "go tool wails3 generate bindings -ts -d frontend/bindings .",
        cwd: "desktop",
        cache: false,
      },
      "desktop:frontend:api:generate": {
        command: "node generate.mjs openapi.generated.json",
        cwd: "tools/api-codegen",
        dependsOn: ["app-server:api:generate"],
      },
      "desktop:frontend:build": {
        command: ["tsc --noEmit", "vp build"],
        cwd: "desktop/frontend",
        dependsOn: ["desktop:frontend:api:generate", "desktop:bindings:generate"],
      },
      "desktop:frontend:test": {
        command: "vp test run",
        cwd: "desktop/frontend",
        dependsOn: ["desktop:bindings:generate"],
      },
      dev: {
        command: "node tools/wails.mjs dev",
        dependsOn: ["app-server:build"],
        cache: false,
      },
      format: {
        command: [
          "vp fmt",
          "golangci-lint fmt",
          "cargo fmt --all",
          "clang-format -i browser-worker/protocol/worker.proto user-browser/protocol/user_browser.proto",
        ],
        cache: false,
      },
      test: {
        command: [
          "cargo test --locked --workspace",
          "go test -count=1 ./browser-worker/... ./user-browser/... ./internal/... ./desktop/...",
        ],
        dependsOn: ["desktop:frontend:build", "desktop:frontend:test", "tools:openapi-docs:test"],
        cache: false,
      },
      "tools:openapi-docs:test": {
        command: "vp test run",
        cwd: "tools/openapi-docs",
        cache: false,
      },
      "user-browser:browser:test": {
        command: "go test ./user-browser/browser/... -count=1 -v",
        cache: false,
      },
      "user-browser:build": {
        command: "go build -o ./desktop/build/bin/ ./user-browser/cmd/ku-potato-user-browser",
        cache: {
          input: ["user-browser/**/*", "internal/**/*", "go.mod", "go.sum"],
          output: ["desktop/build/bin/ku-potato-user-browser*"],
          env: ["GOOS", "GOARCH", "CGO_ENABLED", "GOTOOLCHAIN"],
        },
      },
      "user-browser:proto:check": {
        command: "clang-format --dry-run --Werror user-browser/protocol/user_browser.proto",
        cache: false,
      },
      "user-browser:proto:generate": {
        command: "go run ./tools/proto-codegen",
        cache: false,
      },
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
