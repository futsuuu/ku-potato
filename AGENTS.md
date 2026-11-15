## Repository layout

- `app-server/`: Rust HTTP server in `src/http.rs`, SeaORM archive in `src/archive/`, and gRPC clients in `src/browser/`
- `browser-worker/`: gRPC browser service, scheduler, and protobuf contract in `protocol/`
- `user-browser/`: gRPC authentication service, persistent Chrome profile, and WebAuthn credentials
- `internal/`: Go code shared by the server and browser services
- `internal/appdirs/`: OS-specific directory defaults shared with desktop
- `desktop/`: Wails app, server launcher, and frontend
- `tools/`: Server packaging, API and protobuf code generation, and database documentation
- `vite.config.ts`: Build and check tasks

## Working conventions

- Keep Rust unit tests inline with their implementations. Subsystem integration tests go in its `tests/` directory.
- Keep documentation minimal.
