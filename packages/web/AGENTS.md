<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may
all differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing Next.js code.
<!-- END:nextjs-agent-rules -->

# `web` — Package-Local Rules

> Cross-cutting rules live in the root `AGENTS.md`. This file adds only
> `web`-specific boundaries and conventions.

## Package Role

- `web` is the Next.js UI and BFF package. It owns Route Handlers, browser UI,
  client state, IndexedDB-backed user preferences, E2E tests, and runtime browser
  verification.
- Business logic and external I/O stay in `@reef/core`; `web` composes them
  through thin Route Handlers and browser-facing UI.
- Preserve `next.config.ts` `output: "standalone"` for Docker.

## Subtree Rules

- Source-wide rules, proxy/CSP logging, and browser runtime verification live in
  `packages/web/src/AGENTS.md`.
- App Router and Route Handler rules live in `packages/web/src/app/AGENTS.md`.
- Feature, React state, and client mutation rules live in
  `packages/web/src/features/AGENTS.md`.
- Field leaf rules live in `packages/web/src/components/fields/AGENTS.md`.
- Dexie/IndexedDB store rules live in `packages/web/src/lib/storage/AGENTS.md`.
- Hermetic Playwright and fixture harness rules live in
  `packages/web/tests/e2e/AGENTS.md`.

## Testing Defaults

- Stories are co-located with components. Shared Storybook fixtures live in
  `packages/web/src/__stories__/fixtures.ts` and use Zod-inferred core types.
- Unit tests cover Route Handler behavior, components, and user interactions.
  Co-locate them beside targets.
- Tests default to the jsdom environment. Route Handler tests (`src/app/api/**`)
  run under node automatically; other DOM-free tests (pure logic, stores, `lib`
  helpers) declare `// @vitest-environment node` at the top of the file so they
  do not load jsdom. A missing docblock is silent — the test still passes under
  jsdom — so add it deliberately.
- E2E tests live in `packages/web/tests/e2e/`; LLM evals live in `packages/web/tests/evals/` with
  `vitest.eval.ts`.
- Real GitHub/OpenRouter/AKB contract checks belong in a separate live E2E
  project or command and must not be the default `test:e2e` signal.
