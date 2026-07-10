# @reef/jira-migrator

Operator-run package for one-shot Jira migrations into Reef. The package is
intentionally outside `@reef/web`: Jira credentials are deployment/operator
secrets, not user state in the product runtime.

At the current scaffold stage, the CLI validates migration configuration and
prints a redacted public config. It does not write to Jira or Reef.

## Documentation Policy

- This README is the package entry point for engineers and operators. Keep it
  focused on scope, quick start, package commands, exported surfaces, and links.
- `../../docs/jira-migration.md` is the canonical operator runbook and migration
  policy document. Keep field mapping, account mapping, report interpretation,
  and Jira-to-Reef behavior there.
- `AGENTS.md` is for agent-only implementation rules.
- When CLI flags or environment variables change, update this README and
  `../../docs/jira-migration.md` together.

## Quick Start

Run the scaffolded dry-run from the repository root:

```bash
pnpm --filter @reef/jira-migrator run start -- \
  --jira-base-url https://example.atlassian.net \
  --project-key SHDEV \
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
- SHDEV Jira Rank import planning helpers.

The planning surface uses stable Jira Cloud, project, Version, and Sprint ids;
project keys such as SHDEV are fixtures and operator inputs, never exported API
names. See the operator runbook for lifecycle mapping, source selection, ledger
precedence, and report interpretation.

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
- [Root README](../../README.md)
- [Root agent contract](../../AGENTS.md)
- [Package agent rules](AGENTS.md)
