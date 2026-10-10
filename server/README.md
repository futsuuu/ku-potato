# Server architecture

The Go server follows Hexagonal Architecture (Ports & Adapters).

| Path | Responsibility |
| --- | --- |
| `domain/` | Models and business rules. |
| `core/` | Application workflows and operation workers. |
| `core/inport/` | Application features exposed to inbound adapters. |
| `core/outport/` | Interfaces for browser access, storage, jobs, and files. |
| `httpapi/` | Huma HTTP adapter; operation status and results stream over SSE. |
| `chromedp/` | KU-LMS browser adapter. |
| `sqlite/`, `memory/`, `filesystem/` | Archive/authentication-state storage, in-memory job queue, and acquired files. |
| `platform/` | OS-specific data/state/cache/temp directory defaults. |
| `cmd/ku-potato-server/` | Entrypoint, adapter composition, and single-process lock. |
| `docs/ku-lms.md` | [KU-LMS behavior notes](docs/ku-lms.md). |

`core` implements inbound ports and depends on outbound ports. Inbound adapters use `core/inport`; outbound adapters implement `core/outport`. Adapters do not import concrete application implementations or each other; the entrypoint composes them. `domain` has no application or adapter dependencies.

Browser pages persist across requests, with one page per BrowserContext. Authentication and credential writes are serialized; subsequent operations run concurrently in separate BrowserContexts. Jobs exist only in memory; archives, authentication state, and acquired files persist separately from cache and temporary files.
