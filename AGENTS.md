## Repository layout

- `app-server/`: HTTP application server, authentication, archives, and browser worker client in `browserworker/`
- `browser-worker/`: gRPC browser service, scheduler, and protobuf contract in `protocol/`
- `internal/`: Go code shared by the server and worker, including browser primitives and models
- `internal/appdirs/`: OS-specific directory defaults shared with desktop
- `desktop/`: Wails app, server launcher, and frontend
- `tools/`: API, database, and protobuf code generation
- `vite.config.ts`: Build and check tasks

## Working conventions

- Keep module tests beside implementations. Subsystem integration tests go in its `tests/` directory.
- Keep documentation minimal.
