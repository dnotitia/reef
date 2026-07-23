# @reef/jira-migrator

Operator-run package for one-shot Jira migrations into Reef. The package is
intentionally outside `@reef/web`: Jira credentials are deployment/operator
secrets, not user state in the product runtime.

The CLI is the end-to-end composition root: it performs read-only Jira
discovery, archives source payloads, produces an approval-bound dry-run report,
and applies/resumes idempotent writes through the public `@reef/core` AKB
adapter. The library surfaces the same runner for controlled automation.

## Documentation Policy

- This README is the package entry point for engineers and operators. Keep it
  focused on scope, quick start, package commands, exported surfaces, and links.
- `../../docs/jira-migration.md` is the canonical operator runbook and migration
  policy document. Keep field mapping, account mapping, report interpretation,
  and Jira-to-Reef behavior there.
- When CLI flags or environment variables change, update this README and
  `../../docs/jira-migration.md` together.

## Quick Start

Create one private mapping policy per selected project, then run from the
repository root:

```bash
pnpm --filter @reef/jira-migrator run start -- \
  --dry-run \
  --jira-base-url https://example.atlassian.net \
  --jira-cloud-id cloud-id \
  --project-key ALPHA \
  --project-key BETA \
  --mapping-policy ALPHA=/private/alpha-policy.json \
  --mapping-policy BETA=/private/beta-policy.json \
  --board-id 42 \
  --akb-base-url https://akb.example.internal \
  --vault reef-test \
  --run-id jira-2026-07-23 \
  --ledger-path /private/jira/ledger.json \
  --archive-root /private/jira/archive \
  --account-mapping-path /private/jira/accounts.json \
  --report-path /private/jira/report.json
```

Credentials come from environment variables or private regular files, never
from raw argv values:

```bash
export REEF_JIRA_EMAIL=operator@example.com
export REEF_JIRA_API_TOKEN_FILE=./secrets/jira-api-token
export REEF_AKB_JWT_FILE=./secrets/akb-jwt
```

After reviewing the completed dry-run report, copy its `plan_sha256` exactly:

```bash
pnpm --filter @reef/jira-migrator run start -- \
  --apply \
  ...the-identical-source-target-and-artifact-scope... \
  --expected-plan-sha256 <approved-sha256>
```

An interrupted apply is restarted with the same run/artifact paths and
`--resume jira-2026-07-23`. The runner rejects source, target actor/vault, run,
or plan drift before mutating AKB.

See `../../docs/jira-migration.md` for the full configuration matrix and
operator procedure.

## Package Surface

The package exports:

- CLI/config loading helpers that keep secrets out of public output.
- `runJiraMigration`, the planning-first dry-run/apply/checkpoint/report
  composition root, and the public AKB target adapter.
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
  Reef target implementation. Role/group-restricted and Jira Service
  Management internal comments are isolated instead of being published without
  their source ACL; missing or malformed expanded comment properties fail
  closed. If visibility becomes unsafe on a rerun, imported comments are
  deleted and attachment bytes are revoked with readback. Attachment bindings
  are removed, while deleted comment bindings remain as quarantine tombstones
  until that source ID returns with safe visibility. The same reconciliation
  applies when a previously imported comment disappears from the readable
  catalog or the catalog read fails; per-issue attachment bindings also revoke
  bytes for attachments that disappear from the later issue payload. Attachment
  import requires an
  explicit operator attestation that the comment catalog is complete plus a
  positive byte limit; without it, or when any comment restriction is visible,
  issue attachments are isolated because Jira does not expose a reliable
  attachment-to-comment ACL association through this stage's source contract.
  Both declared sizes and streamed response bytes are bounded by that limit;
  limits above 256 MiB are rejected before fetch so a policy value cannot force
  an impractical allocation. The Node 22 implementation grows one resizable
  buffer with received bytes instead of preallocating the limit or retaining a
  second full-size copy.
  Lowering the limit on a rerun revokes attachments that no longer satisfy the
  policy, replaces their generated description/comment file references with a
  stable private placeholder, and verifies that neither bytes nor stale file
  references remain. A later eligible rerun reconciles that placeholder to the
  newly stored file URI. Edited Jira comments update their existing Reef
  comment and ledger binding with readback instead of being duplicated or
  permanently rejected. Existing V1 attachment ledger identities without an
  issue ID remain readable and are attributed through target readback when
  reconciliation is required.
  Dry-run performs the same bounded source reads and validations as apply while
  keeping Reef target mutations at zero. When the issue description was first
  projected with raw-archive or account-mapping options, pass the same options
  as `descriptionConversionOptions`; legacy and current media placeholders are
  then both accepted by the description precondition.
  Standard link mappings must resolve to exactly one configured rule;
  overlapping matches are isolated as ambiguous rather than selected by array
  order. Successful explicit standard-link and remote-link catalogs also
  reconcile target relations/refs that disappeared or changed identity; an
  omitted standard-link field or failed remote-link read is not treated as an
  empty catalog. A returned remote identity without a usable URL invalidates
  and removes its prior ref while recording an isolated entity failure.
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

## Public Boundary And Internal Layout

Consumers import only from `@reef/jira-migrator`; package subpaths are not a
supported API. The root surface exposes operator configuration, Jira reads and
normalization, migration planners, ledger operations, raw-archive operations,
and the related-data façade. Low-level object/redaction helpers, canonical JSON
implementation details, and related-data reconciliation helpers stay internal.

Implementation is grouped by ownership under `src/`: `jira` owns wire schemas,
normalization, authentication, and reads; `archive` owns raw preservation;
`execution` owns the ledger/checkpoint/report kernel; `accounts`, `content`,
`planning`, and `issues` own migration transformations; `related` composes the
comments, attachments, media, and link stages; and `cli` is the composition
root. `src/index.ts` remains the only library entry point.

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
pnpm --filter @reef/jira-migrator run build
pnpm --filter @reef/jira-migrator run test:behavior
```

`test:behavior` builds the package and runs a source-blind ALPHA/BETA contract
against mock Jira and isolated mock AKB HTTP services. It proves GET-only Jira
traffic, dry-run target mutation zero, plan-hash approval, write/readback
checkpoint ordering, fresh-process resume, cross-project relation
reconciliation, rerun duplicate zero, conservation, and report redaction.

Workspace-wide gates:

```bash
pnpm biome check .
pnpm -r run typecheck
pnpm -r run test
```

## Related Docs

- [Jira migration runbook and policy](../../docs/jira-migration.md)
