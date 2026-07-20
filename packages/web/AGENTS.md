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

## UX Contract

- Concrete web UX policy lives in `docs/ux-design.md`: surface map,
  loading/empty/error behavior, AI affordance tone, component strategy, and
  state-owner consequences. Read it before visible UX/layout work and update it
  when those contracts change.

## Internationalization (i18n)

- User-facing web copy goes through the message catalog, never a hardcoded JSX
  literal. In a component, `const t = useTranslations("namespace")` and render
  `{t("key")}`; embedded elements (a link inside a sentence) use `t.rich` so each
  locale owns word order. The catalog lives at `src/i18n/messages/{en,ko}.json`
  as nested namespaces — `en` is the structural source of truth and `ko` is a
  partial over it, so any key ko omits falls back to en (REEF-291 / REEF-293).
- Keys are type-checked: the `next-intl` `AppConfig` augmentation
  (`src/i18n/next-intl.d.ts`) types `t(...)` against the en catalog, so a missing
  or misspelled key fails `pnpm -r run typecheck`. `src/i18n/messages.test.ts`
  also asserts ko ⊆ en and non-empty leaves.
- A new hardcoded user-facing literal fails the i18n guard in `pnpm -r run test`
  (`src/i18n/guard/`) when it lands in one of the two scanned shapes: a **JSX**
  text node / user-facing attribute (`aria-label`/`title`/`placeholder`/…), or
  the **message argument of a `toast(...)` / `toast.*()` call** (REEF-299, the
  first arg only). Route it through `useTranslations`, or — for a genuinely
  non-localized literal like a brand name — add an `i18n-exempt` line comment.
  The guard is a one-way ratchet against `baseline.json`: it only shrinks. After
  migrating strings, prune resolved entries with
  `pnpm --filter @reef/web i18n:baseline`.
- The guard cannot catch every non-JSX leak, and deliberately does not try (a
  literal-vs-key heuristic over arbitrary `.ts` would fire on enum values, keys,
  and config — too noisy). When you add or edit one of these, route the copy
  through the catalog by **review checklist**, because the guard will stay green
  regardless:
  - copy hoisted into `.ts` data structures rendered via `{expr}` — column-header
    and field-name label arrays (`COLUMN_KEYS` → `fieldNames`,
    `enrichmentFieldDescriptors` `labelKey`), local label maps in a chart/report;
  - a toast `description`/options string (the guard only reads the first arg);
  - a string built by a helper and then handed to `toast` (localize in the
    helper or pass `t`).
- Unit tests that render a migrated component wrap it in `IntlTestProvider` from
  `@/i18n/i18n.testSupport` (pass `locale="ko"` to assert the translated surface).
- Scope split (epic REEF-178): this is the **web chrome** catalog (S3). core
  field-registry labels are S2 (REEF-292) and date/number/relative-time formats
  are S4 (REEF-294) — keep those out of this catalog.
- Server/core error messages are the `errors.*` namespace (REEF-297). `core`
  owns the stable error codes plus the en base catalog (`ERROR_MESSAGES_EN`,
  composed into `errors.*` in `i18n/messages.ts`, exactly like the field catalog)
  and never resolves a locale; `describeError` hands `web` a `{ code, status }`.
  Route Handlers localize at the boundary through `lib/api/errorLocalization`
  (`localizeError` for a `ReefError`, `localizedErrorResponse` for a web-owned
  `errors.*` key such as `sessionExpired`); locale is read from `next/headers`
  (cookie → `Accept-Language` → en), so outside a request scope detection falls
  back to en. Do not build a localized error body in `core` or hardcode an
  English error string in a Route Handler.

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
- Real GitHub/LLM/AKB contract checks belong in a separate live E2E
  project or command and must not be the default `test:e2e` signal.
