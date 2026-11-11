## Repository layout

- `app-server/`: HTTP application server, archives, and gRPC clients in `browserworker/` and `userbrowser/`
- `browser-worker/`: gRPC browser service, scheduler, and protobuf contract in `protocol/`
- `user-browser/`: gRPC authentication service, persistent Chrome profile, and WebAuthn credentials
- `internal/`: Go code shared by the server and browser services
- `internal/appdirs/`: OS-specific directory defaults shared with desktop
- `desktop/`: Wails app, server launcher, and frontend
- `tools/`: API, database, and protobuf code generation
- `vite.config.ts`: Build and check tasks

## Working conventions

- Keep module tests beside implementations. Subsystem integration tests go in its `tests/` directory.
- Keep documentation minimal.
