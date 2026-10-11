## Architecture

The server follows Hexagonal Architecture (Ports & Adapters).

- `domain/`: Models and business rules
- `core/`: Application workflows and operation workers
- `core/inport/`: Application features exposed to inbound adapters
- `core/outport/`: Interfaces for browser access, storage, jobs, and files
- `httpapi/`: Huma HTTP adapter; operation status and results stream over SSE
- `chromedp/`: KU-LMS browser adapter
- `sqlite/`: Archive/authentication-state storage
- `memory/`: In-memory job queue
- `filesystem/`: Acquired files
- `platform/`: OS-specific data/state/cache/temp directory defaults
- `cmd/ku-potato-server/`: Entrypoint, adapter composition, and single-process lock
- `docs/ku-lms.md`: KU-LMS behavior notes

`core` implements inbound ports and depends on outbound ports.
Inbound adapters use `core/inport`; outbound adapters implement `core/outport`.
Adapters do not import concrete application implementations or each other; the entrypoint composes them.
`domain` has no application or adapter dependencies.
