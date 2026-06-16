# `core` — Package-Local Rules

> Cross-cutting rules live in the root `AGENTS.md`. This file adds only
> `core`-specific boundaries and conventions.

## Package Role

- `core` owns framework-agnostic schemas, models, adapters, agents, errors, and
  utilities. Do not import Next.js, React, DOM APIs, or browser storage here.
- Data-plane access to akb, GitHub, and LLM providers originates here. `web`
  calls `core` through thin Route Handlers.
- Domain layout is
  `packages/core/src/{schemas,models,adapters,agents,errors,utils,index}/`.

## Subtree Rules

- Adapter-specific rules live in `packages/core/src/adapters/AGENTS.md`.
- Agent and AI SDK tool rules live in `packages/core/src/agents/AGENTS.md`.
- Issue schema and field registry rules live in
  `packages/core/src/schemas/issues/AGENTS.md`.

## Testing And Layout

- Unit tests cover business logic, schemas, parsing, and ID generation.
- Integration tests cover adapter/tool behavior with external APIs mocked via
  MSW. Co-locate tests beside their targets.
- Zod schemas use PascalCase plus `Schema`; error classes use PascalCase plus
  `Error` and extend `ReefError`; AI tool names are `snake_case`.
- Agent building blocks live under `agents/` itself:
  `agents/{framework,prompts,tools}/`.
