## Repository layout

- `app-server/`: Rust HTTP server in `src/http.rs`, SeaORM archive in `src/archive/`, gRPC clients in `src/browser/`, server tools in `tools/`, and generated documentation in `docs/`
- `browser-worker/`: gRPC browser service, scheduler, and protobuf contract in `protocol/`
- `user-browser/`: gRPC authentication service, persistent Chrome profile, and WebAuthn credentials
- `internal/`: Go code shared by the server and browser services
- `internal/appdirs/`: OS-specific directory defaults shared with desktop
- `desktop/`: Wails app, server launcher, and frontend
- `tools/`: Shared protobuf code generation and telemetry viewer
- `vite.config.ts`: Build and check tasks

## Working conventions

- This project has not been released yet. Do not preserve backward compatibility or add migration logic for breaking changes.
- Keep Rust unit tests inline with their implementations. Subsystem integration tests go in its `tests/` directory.
- Keep documentation minimal.
