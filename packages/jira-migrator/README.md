# @reef/jira-migrator

Operator-run package for one-shot Jira migrations into Reef. The package is
intentionally outside `@reef/web`: Jira credentials are deployment/operator
secrets, not user state in the product runtime.

The CLI still validates migration configuration and prints a redacted public
config. The library additionally builds immutable Jira issue import plans and
exposes a dependency-injected related-data stage for comments,
attachments/media, and links. Final project traversal and CLI orchestration
remain separate.

## Documentation Policy

- This README is the package entry point for engineers and operators. Keep it
  focused on scope, quick start, package commands, exported surfaces, and links.
- `../../docs/jira-migration.md` is the canonical operator runbook and migration
  policy document. Keep field mapping, account mapping, report interpretation,
  and Jira-to-Reef behavior there.
- When CLI flags or environment variables change, update this README and
  `../../docs/jira-migration.md` together.

## Quick Start

Run the scaffolded dry-run from the repository root:

```bash
pnpm --filter @reef/jira-migrator run start -- \
  --jira-base-url https://example.atlassian.net \
  --project-key PROJECT \
  --vault reef-test \
  --dry-run
```

Credentials come from environment variables or local secret files:

```bash
export REEF_JIRA_EMAIL=operator@example.com
export REEF_JIRA_API_TOKEN_FILE=./secrets/jira-api-token
```

`publicJiraMigratorConfig` and `redactForConfig` are the only supported ways to
serialize config/report data; they omit or redact secret values.

See `../../docs/jira-migration.md` for the full configuration matrix and
operator procedure.

## Package Surface

The package exports:

- CLI/config loading helpers that keep secrets out of public output.
- A read-only Jira REST client and Jira payload schemas/normalizers.
- Generic Jira Version and board/Sprint catalog readers with pagination, plus
  field-catalog-based Sprint reference discovery.
- Immutable Version/Sprint planning action plans that classify target work as
  `create`, `reuse`, `conflict`, or `unsupported` before any Reef write.
- Local Jira account mapping artifact helpers.
- A verifiable raw archive API for pre-validation Jira JSON, returning opaque
  `{runId, entryId, contentSha256}` references instead of copying payloads into
  downstream plans or reports.
- A strict local `JiraMigrationLedgerV1` execution-state artifact with stable
  source identities, readback-confirmed target bindings, shared diff decisions,
  entity-key checkpoints, deterministic reports, and guarded atomic file I/O.
- Jira Rank import planning helpers.
- `importJiraRelatedData`, which supports mutation-free dry runs and idempotent
  apply/readback for threaded comments, controlled attachment downloads, ADF
  media rewrites, standard issue links, and remote links through an isolated
  Reef target implementation.
- Tenant field-catalog resolution, ADF-to-Markdown conversion, and immutable
  `JiraIssueImportPlan` builders that combine configurable enum policies,
  account mappings, planning bindings, parents, Rank, compact provenance, and
  field-level reports without performing I/O.
- An immutable `buildJiraChangelogPlan` surface that consumes one verified raw
  history reference, classifies every item as `promoted`, `raw`, `deferred`, or
  `failed`, and emits only lossless activity/external-reference actions with
  deterministic migration event keys.

The planning surface uses stable Jira Cloud, project, Version, and Sprint ids;
project keys are operator inputs, never exported API names. See the operator
runbook for lifecycle mapping, source selection, ledger precedence, and report
interpretation.

Issue plans require pre-created opaque raw archive references and consume only
the target mappings returned by `buildJiraPlanningTargetMappings`. A plan never
creates planning entities, performs an AKB write, or embeds raw ADF, watcher
payloads, email addresses, or full Jira account objects.

Use `@reef/core` for shared Reef contracts where available. Do not import
`@reef/web` or browser/Next.js runtime APIs into this package.

## Raw Archive

`createRawArchive`, `readRawArchiveReference`, and `verifyRawArchive` preserve
JSON values before Jira Zod validation or normalization. Objects are JCS
canonicalized, addressed by SHA-256, stored once, and referenced from a
versioned run manifest. The archive returns only opaque references and safe
verification summaries; callers must not add raw values to logs or reports.
Entity-specific identity shapes are exported as
`RawArchiveSourceIdentityByKind`, with runtime-required keys available from
`RAW_ARCHIVE_SOURCE_IDENTITY_REQUIRED_KEYS`; use them instead of guessing a
generic identity record.

Create the archive under an operator-owned, encrypted local volume outside the
repository. POSIX roots and directories must be private (`0700`) and files use
`0600`. Windows operators must establish a dedicated-user ACL and pass an
`external_acl` acknowledgement. A retention owner, future expiry, and policy
reference are required. Synchronized or network filesystems are unsupported.

The repository-level `/artifacts/` ignore rule is a last-resort commit guard,
not an operational storage default. See the operator runbook for recovery,
stale-lock, access-review, retention, and sanitization procedures.

## Changelog Planning

Archive each Jira changelog history before calling `buildJiraChangelogPlan`.
The planner verifies the opaque archive checksum against the exact
pre-normalization payload and rejects a missing or mismatched reference. It
promotes supported field-id/exact-alias mappings only when every target value,
actor, timestamp, and required binding or current snapshot resolves without
loss. Everything else remains raw, deferred, or failed; it never fabricates a
Reef action.

The returned plan is deeply frozen and includes per-item classifications,
aggregate and per-field counts, opaque preservation locations, and stable
`jira-changelog:<cloud>:<issue>:<history>:<item>:<event>` keys. Reports and
actions intentionally exclude raw authors, source bodies, credentials, and
local archive paths. The full mapping and replay policy is in the operator
runbook.

## Ledger And Checkpoint

`loadJiraMigrationLedger` treats only a missing path as an empty version 1
artifact. Malformed JSON, an unsupported schema version, a Jira Cloud or target
vault scope mismatch, invalid private permissions, or a sibling lock all stop
the run with a typed safe error. `writeJiraMigrationLedger` validates the full
strict schema and configured forbidden secret values before taking an exclusive
sibling lock. For an existing artifact, pass the value returned by
`loadJiraMigrationLedger` as `expectedLedger`; the writer re-reads and compares
that precondition while holding the lock, rejecting a missing precondition or a
stale writer with `write_precondition_required` or `stale_ledger`. It then
flushes a private temporary file, atomically replaces the artifact, and reloads
it for identity readback.

Use the exported source-identity builders, `fingerprintJiraState`, and
`classifyJiraMigrationDiff` for both dry-run and apply. Persist a binding with
`confirmJiraMigrationBinding` only after the target write and target identity
readback both succeed. Every entity result persists its sanitized source and
mapped-state fingerprints; retry classification compares those saved
preconditions with the current fingerprints after restart instead of accepting
a caller-supplied match flag. `openJiraMigrationRun`, checkpoint reducers, and
`buildJiraMigrationReport` operate on canonical entity keys rather than input
array indexes, so reordered inputs and multiple Jira projects in one Cloud
scope resume deterministically.

The ledger is operator-owned local execution state, not a raw payload archive,
an AKB table, or reef-web persistence. Keep it on an encrypted local volume,
back it up before an apply, and never delete a stale lock automatically. See
the operator runbook for the full resume and repair procedure.

## Commands

Run from the repository root:

```bash
pnpm --filter @reef/jira-migrator run typecheck
pnpm --filter @reef/jira-migrator run test
pnpm --filter @reef/jira-migrator run smoke:dry-run
```

`smoke:dry-run` requires the same Jira, vault, and credential settings as the
CLI quick start.

Workspace-wide gates:

```bash
pnpm biome check .
pnpm -r run typecheck
pnpm -r run test
```

## Related Docs

- [Jira migration runbook and policy](../../docs/jira-migration.md)
