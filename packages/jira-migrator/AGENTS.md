# `jira-migrator` - Package-Local Rules

> Cross-cutting rules live in the root `AGENTS.md`. This package owns the
> one-shot Jira-to-Reef migration runtime that must stay outside `reef-web`.

## Package Role

- `jira-migrator` owns operator-run Jira discovery, migration config, payload
  normalization, private raw archives and account mappings, immutable import
  plans, durable local ledgers/checkpoints, deterministic reports, and
  dependency-injected Reef related-data apply/readback. Project keys are
  operator inputs, not API naming boundaries.
- Jira is always a read-only source: Jira HTTP traffic stays GET-only. Apply
  means writing or reconciling Reef targets through an explicit target contract;
  it never means mutating Jira.
- Keep dry-run mutation-free. Apply paths must be idempotent, read back target
  state before confirming ledger bindings, isolate independent entity failures,
  and preserve the source visibility restrictions for comments and attachments.
- Use `@reef/core` for shared Reef contracts where available. Do not import
  `@reef/web`, Next.js, React, DOM APIs, Route Handlers, or browser storage.
- Credentials come only from environment variables or local secret files. Never
  print, log, serialize to reports, or include Jira credentials in AKB payloads.
- Raw archives, ledgers, reports, and account mappings are operator-owned local
  artifacts. Preserve their private-permission, symlink, lock, atomic-write,
  secret-redaction, scope, and integrity checks.

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
- Apply/reconciliation tests must cover mutation-free dry runs, idempotent
  reruns, target readback before binding confirmation, visibility revocation,
  bounded attachment handling, and partial-failure recovery.
