# `jira-migrator` - Package-Local Rules

> Cross-cutting rules live in the root `AGENTS.md`. This package owns the
> one-shot Jira-to-Reef migration runtime that must stay outside `reef-web`.

## Package Role

- `jira-migrator` owns operator-run Jira read paths, migration config loading,
  dry-run/report helpers, and Jira payload normalization for the SHDEV/SDDEV
  migration.
- Keep the package read-only against Jira until a later issue explicitly adds a
  write/import mapping phase.
- Use `@reef/core` for shared Reef contracts where available. Do not import
  `@reef/web`, Next.js, React, DOM APIs, Route Handlers, or browser storage.
- Credentials come only from environment variables or local secret files. Never
  print, log, serialize to reports, or include Jira credentials in AKB payloads.

## Documentation Policy

- Keep `packages/jira-migrator/README.md` as the package entry point: role,
  current CLI status, package commands, exported surfaces, and links.
- Keep operator runbooks, migration field policies, report interpretation,
  account mapping, and Jira-to-Reef data mapping details in
  `docs/jira-migration.md`.
- Keep agent-only implementation rules in this file. Do not put operator
  procedures here unless they are also rules for future agents editing code.
- When adding or changing CLI flags, environment variables, or secret-loading
  behavior, update both the README quick start and `docs/jira-migration.md`.
- When adding or changing migration semantics, provenance shape, or report
  classifications, update `docs/jira-migration.md` beside the code and tests.

## Testing And Layout

- Co-locate unit tests beside their targets under `src/`.
- Fixture-based tests should exercise Jira wire payload schemas and normalized
  migration shapes.
- Client tests must assert read-only HTTP methods, pagination cursors,
  rate-limit metadata, retryable error classification, and secret redaction.
