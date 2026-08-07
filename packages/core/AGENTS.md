# `core` — Package-Local Rules

> Cross-cutting rules live in the root `AGENTS.md`. This file adds only
> `core`-specific boundaries and conventions.

## Package Role

- `core` owns framework-agnostic schemas, models, the concrete AKB adapter,
  errors, observability, and utilities. Do not import Next.js, React, DOM APIs,
  browser storage, AI SDK runtime code, GitHub SDKs, or LLM provider clients.
- Product AKB data-plane and auth/session access originates here. The server-only
  `web` package owns GitHub/LLM provider adapters and agent application code;
  operator and worker packages consume core's public contracts without importing
  web.
- AKB adapter diagnostics that should appear in both traces and optional backend
  logs use `observe` from `src/observability/index.ts`. Keep logged/span fields
  credential-safe and operational: status, duration, counts, and bounded labels.
- Do not import pino, `@/lib/logging/logger`, or Next.js instrumentation in
  `core`; `web` decides whether core measurements are also emitted to stdout.
- Domain layout is
  `packages/core/src/{schemas,models,adapters/akb,errors,observability,utils}/`,
  with the public package surface in `src/index.ts`.

## Subtree Rules

- AKB adapter-specific rules live in `packages/core/src/adapters/AGENTS.md`.
- Issue schema and field registry rules live in
  `packages/core/src/schemas/issues/AGENTS.md`.
- Planning schema and field registry rules live in
  `packages/core/src/schemas/planning/AGENTS.md`.

## Testing And Layout

- Unit tests cover business logic, schemas, parsing, and ID generation.
- Integration tests cover AKB adapter behavior with external APIs mocked via
  MSW. Co-locate tests beside their targets.
- Zod schemas use PascalCase plus `Schema`; error classes use PascalCase plus
  `Error` and extend `ReefError`; AI tool names are `snake_case`.
