# Jira Migration

This is the canonical operator runbook and migration policy document for
one-shot Jira-to-Reef migrations. Package-local orientation stays in
`packages/jira-migrator/README.md`; agent-only implementation rules stay in
`packages/jira-migrator/AGENTS.md`.

## Scope And Status

`@reef/jira-migrator` owns operator-run Jira read paths, migration config
loading, dry-run/report helpers, Jira payload normalization, local account
mapping artifacts, and source-system ordering plans for SHDEV/SDDEV migrations.

The package is intentionally outside `@reef/web`: Jira credentials are
deployment/operator secrets, not user state in the product runtime. Keep the
package read-only against Jira unless a later issue explicitly adds a write or
import mapping phase.

At the current scaffold stage, the CLI validates configuration and prints a
redacted public config. It does not write to Jira or Reef.

## Documentation Placement

- `packages/jira-migrator/README.md` is the package entry point: purpose, quick
  start, commands, exported surfaces, and links.
- This file owns operator procedures, source-to-target mapping policy, report
  interpretation, account mapping, security handling, and Jira-to-Reef migration
  decisions.
- `packages/jira-migrator/AGENTS.md` owns agent-only implementation rules.
- CLI flag, environment variable, or secret-loading changes must update both the
  package README and this runbook.
- Migration semantics, provenance shape, field mapping, or report
  classification changes must update this runbook beside code and tests.

## Operator Runbook

Run the current dry-run scaffold from the repository root:

```bash
pnpm --filter @reef/jira-migrator run start -- \
  --jira-base-url https://example.atlassian.net \
  --project-key SHDEV \
  --vault reef-test \
  --account-mapping ./artifacts/jira-account-mapping.cloud-abc.json \
  --report ./artifacts/jira-migration-report.json \
  --dry-run
```

The scaffolded CLI prints `publicJiraMigratorConfig(config)` as JSON. That
output is safe for logs and reports because it omits secret values.

When an installed build is used, the binary name is:

```bash
reef-jira-migrator --project-key SHDEV --vault reef-test --dry-run
```

## Configuration

The package loads non-secret settings from CLI flags or environment variables.
Credentials come only from environment variables or local secret files.

| CLI flag | Environment variable | Purpose |
| --- | --- | --- |
| `--jira-base-url` | `REEF_JIRA_BASE_URL` or `JIRA_BASE_URL` | Jira tenant URL. Must be HTTPS. |
| `--jira-cloud-id` | `REEF_JIRA_CLOUD_ID` or `JIRA_CLOUD_ID` | Atlassian Cloud id. When no base URL is supplied, it derives `https://api.atlassian.com/ex/jira/<cloudId>`. |
| `--project-key` | `REEF_JIRA_PROJECT_KEY` or `JIRA_PROJECT_KEY` | Jira project key, normalized to uppercase. |
| `--vault` | `REEF_JIRA_MIGRATOR_VAULT`, `REEF_ORCHESTRATOR_VAULT`, or `REEF_VAULT` | Target Reef workspace vault. |
| `--report` | `REEF_JIRA_MIGRATOR_REPORT_PATH` | Optional local report path. |
| `--account-mapping` | `REEF_JIRA_ACCOUNT_MAPPING_PATH` | Optional local Jira account mapping artifact path. |
| `--api-token-file` | `REEF_JIRA_API_TOKEN_FILE` or `JIRA_API_TOKEN_FILE` | Local secret file containing a Jira API token for basic auth. |
| `--bearer-token-file` | `REEF_JIRA_BEARER_TOKEN_FILE` or `JIRA_BEARER_TOKEN_FILE` | Local secret file containing a Jira bearer token. |
| `--dry-run` | `REEF_JIRA_MIGRATOR_DRY_RUN` | Load config and report readiness without migrating. |

Basic auth uses `REEF_JIRA_EMAIL` or `JIRA_EMAIL` plus one of
`REEF_JIRA_API_TOKEN`, `JIRA_API_TOKEN`, `REEF_JIRA_API_TOKEN_FILE`, or
`JIRA_API_TOKEN_FILE`.

Bearer auth uses one of `REEF_JIRA_BEARER_TOKEN`, `JIRA_BEARER_TOKEN`,
`REEF_JIRA_BEARER_TOKEN_FILE`, or `JIRA_BEARER_TOKEN_FILE`.

Configure either basic auth or bearer auth, not both.

## Secret And Report Handling

`publicJiraMigratorConfig` and `redactForConfig` are the only supported ways to
serialize config or report data. They omit or redact secret values.

Never put Jira API tokens, bearer tokens, auth headers, raw cookies, or local
secret-file contents in AKB payloads, reports, logs, issue bodies, PR
descriptions, or committed fixtures.

Local artifacts such as reports and account mapping files can contain Jira
account ids, display names, email addresses, and migration decisions. Keep them
local to the migration run unless a later runbook explicitly defines a sanitized
artifact publication path.

## Jira Account Mapping

Jira Cloud issue payloads identify people by `accountId`. The migrator maps
those account ids to Reef actors in this order:

1. Operator overrides in the account mapping artifact.
2. Email-directory matches when Jira exposes an email address.
3. Existing artifact records from a previous migration scan.
4. A stable fallback actor, `jira:<accountId>`.

Pass a local JSON artifact path with either the CLI flag or environment
variable:

```bash
pnpm --filter @reef/jira-migrator run start -- \
  --jira-cloud-id cloud-abc \
  --project-key SHDEV \
  --vault reef-test \
  --account-mapping ./artifacts/jira-account-mapping.cloud-abc.json \
  --dry-run
```

```bash
export REEF_JIRA_ACCOUNT_MAPPING_PATH=./artifacts/jira-account-mapping.cloud-abc.json
```

The current CLI entrypoint validates and exposes this path in config output.
Migration drivers should load and write the artifact with the exported helpers:

```ts
import {
  collectJiraUserObservations,
  loadJiraAccountMappingArtifact,
  mapJiraIssueActors,
  upsertJiraAccountMappingArtifact,
  writeJiraAccountMappingArtifact,
} from "@reef/jira-migrator";
```

When the configured file is missing, `loadJiraAccountMappingArtifact` returns an
empty artifact for the requested Jira Cloud id. After a scan, write the updated
artifact back so operators can review account ids before import:

```json
{
  "version": 1,
  "jiraCloudId": "cloud-abc",
  "accounts": {
    "acct-reporter": {
      "accountId": "acct-reporter",
      "emailAddress": "requester@example.com",
      "displayName": "Requester",
      "active": true,
      "accountType": "atlassian",
      "actor": "jira:acct-reporter",
      "mappingStrategy": "fallback",
      "overrideReason": null,
      "firstSeenAt": "2026-07-09T08:00:00.000Z",
      "lastSeenAt": "2026-07-09T08:00:00.000Z",
      "projectKeys": ["SHDEV"]
    }
  },
  "overrides": {}
}
```

To override a fallback or email match, add an entry under `overrides` keyed by
the Jira account id:

```json
{
  "overrides": {
    "acct-reporter": {
      "actor": "reef-requester",
      "reason": "operator confirmed requester account"
    }
  }
}
```

On the next mapping pass, `acct-reporter` resolves to `reef-requester` with the
`override` strategy. Removing that override makes the account recalculate from
email-directory data or the stable `jira:<accountId>` fallback; stale override
records are not kept active.

Keep account mapping artifacts local to the migration run. They can contain
Jira account ids, display names, and email addresses, so do not commit them to
the repository or include them in issue bodies, logs, or PR descriptions.

## Jira Rank To Reef Ordering

REEF-393 maps Jira Rank's current value into reef's existing
`reef_issues.rank` column. The column is now the issue-wide numeric ordering
scalar: lower numbers sort earlier, and `NULL` sorts at the ordered tail.

This does not make `rank` a normal user-authored issue field. The product UI
writes it only through backlog drag-to-reorder, and generic issue create/update
schemas still reject caller-supplied rank. Trusted importers, including the
SHDEV Jira migrator, may seed `rank` while creating imported issues.

The SHDEV mapping policy is:

- Sort distinct, non-empty Jira Rank strings lexicographically.
- Assign sparse reef ranks in that order using `RANK_STEP` gaps.
- Preserve the original Jira Rank string in Jira provenance under
  `custom_fields.jira.rank`.
- Classify missing or duplicate Jira Rank values as `rank_unmapped` in dry-run
  and apply reports, and do not invent a reef rank for them.

The board's pristine order uses `rank ASC` inside each workflow column, so Jira
Rank seeded by the migrator is visible on the Kanban board without making
`rank` user-selectable. Explicit board/list user sorts still use the existing
shared sort control, and the issue list keeps its priority-based default. The
query layer accepts `sort_field=rank` for the board's pristine order, backlog
order, import verification, and other internal consumers. Backlog remains
`status=backlog` plus ascending `rank`.

Jira Rank changelog history reconstruction is out of scope. REEF-393 preserves
the current Jira ordering only.

## Jira Version And Sprint Planning Migration

REEF-402 treats Jira Version and Sprint records as independent migration
entities. Issue import consumes the resulting Reef UUID mappings; it does not
create releases or sprints itself.

### Read And Selection Policy

- Read the complete paginated Version catalog for every configured source
  project with `JiraReadClient.readProjectVersionCatalog()`.
- Discover the issue Sprint custom field from Jira's field catalog schema with
  `listFields()` and `normalizeIssueSprintReferences()`; do not hard-code a
  `customfield_NNNNN` id.
- Always include Sprint records referenced by in-scope issues.
- Expand Sprint selection only from boards the operator explicitly configured,
  using `readBoardSprintCatalog()`. A shared board is not inferred from a
  project name.
- Record `configured_project`, `issue_reference`, and `configured_board` in the
  action's selection provenance so dry-run reports explain why each source
  entity is present.

Version identity is `jiraCloudId + projectId + versionId`. Sprint identity is
`jiraCloudId + sprintId`; source names are display and exact-match fallback
values only. The exported identity helpers encode these components into stable
keys suitable for REEF-319 ledger records.

### Lifecycle And Field Mapping

| Jira source | Reef target | Mapping |
| --- | --- | --- |
| Version `released=true` | `reef_releases.status` | `released` |
| Other Version | `reef_releases.status` | `planned`; dates do not imply `in_progress` |
| Version `releaseDate` | release dates | `target_date`, and `released_at` only when released |
| Version description | release notes | `notes` |
| Sprint `future` | `reef_sprints.status` | `planned` |
| Sprint `active` | `reef_sprints.status` | `active` |
| Sprint `closed` | `reef_sprints.status` | `closed` |
| Sprint dates and goal | sprint fields | `start_date`, `end_date`, and `goal` |

Fields Reef cannot express are retained in the whitelisted source provenance,
not silently discarded: Version `startDate` and `archived`, Sprint
`completeDate` and `originBoardId`, plus their stable source ids. The planning
plan intentionally excludes raw payloads, auth headers, credentials, watchers,
and account data.

### Resolution And Report Contract

`buildJiraPlanningMigrationPlan()` is pure and returns a deeply frozen plan.
Dry-run and apply must consume that same plan:

1. Reuse a REEF-319 ledger binding when one exists for the stable source key.
2. Otherwise find case-insensitive exact-name candidates in the matching Reef
   planning table.
3. Reuse only one candidate whose lifecycle and core dates are compatible.
4. Classify no candidate as `create`.
5. Classify duplicate names or incompatible metadata as `conflict` with reason
   `planning_conflict`; do not merge them automatically.
6. Classify an unknown Jira lifecycle as `unsupported` unless a ledger binding
   already supplies the target.

Every action carries field-level `mapped`, `preserved`, `conflict`, or
`unsupported` report entries and a preservation path for source-only fields.
After REEF-321 executes a create action through `@reef/core`, pass the returned
UUID to `resolveJiraPlanningActionTarget()`. REEF-319 can persist that resolution
by stable source identity, while REEF-318 can consume the release and Sprint
maps from `buildJiraPlanningTargetMappings()` without creating planning rows.

SHDEV is the first fixture-backed validation input, but the planning API,
action shape, and tests are project-independent and exercise a second project
key with the same contract.

Official API references:

- [Jira project Version REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-versions/)
- [Jira board Sprint REST API](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-sprint-get)
