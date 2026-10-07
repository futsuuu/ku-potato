## Architecture

This repository follows the Hexagonal Architecture (Ports & Adapters).

- `/domain`
  - Business rules and entities/value objects
- `/core`
  - Orchestrate domain behavior and workflows (application layer)
  - Implement inbound ports
  - Depend on outbound ports
- `/core/in_port`
  - Inbound ports
  - Interfaces that define application features
- `/core/out_port`
  - Outbound ports
  - Interfaces that define application requirements in the outside world
- `/cli`, `/desktop`
  - Inbound adapters (presentation layer)
  - Handle user input and expose application features
  - Depend on inbound ports
- `/playwright`, `/sqlite`
  - Outbound adapters (infrastructure layer)
  - Interact with the outside world
  - Implement outbound ports
- `/cli/main.ts`, `/desktop/server.ts`
  - Program entrypoints (composition root)
  - Construct adapters and the application

### Dependency boundaries

- Inbound adapters import application features only from `/core/in_port`.
- Outbound adapters import application requirements only from `/core/out_port`.
- Only entrypoints import the `/core` root and compose concrete adapters.
- Inbound port effects do not expose outbound service requirements. The application layer resolves them while
  constructing its `Layer`.

## Tests

- Keep module tests alongside their implementation with matching names: `xxx.ts` and `xxx_test.ts`.
- Put integration tests that cannot be paired with a single implementation file in that subsystem's `tests` directory,
  such as `/playwright/tests`.

## References

- Effect v4: `node_modules/effect/AGENTS.md`
- Gunshi (CLI library): `node_modules/@gunshi/docs/src/**/*.md`
  - Most of the information you want is in the `.../docs/src/guide/essentials` directory
