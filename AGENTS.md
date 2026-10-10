## Repository layout

- `server/`: Go HTTP server; see server/README.md
- `desktop/main.go`: Wails entrypoint and native bindings
- `desktop/launcher/`: Reuse the server or start it detached
- `desktop/frontend/`: Solid 2 + UnoCSS UI, API client, and app-specific Vite/TypeScript configuration
- `tools/api-codegen/`: Generate frontend API types from Huma's runtime OpenAPI schema
- `vite.config.ts`: Vite+ tasks and shared lint, type-check, and format settings

## Working conventions

- Keep module tests beside implementations. Subsystem integration tests go in its `tests/` directory.
- Keep documentation minimal.
