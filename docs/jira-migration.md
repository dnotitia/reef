# Jira Migration

This is the canonical operator runbook and migration policy document for
one-shot Jira-to-Reef migrations. Package-local orientation stays in
`packages/jira-migrator/README.md`; agent-only implementation rules stay in
`packages/jira-migrator/AGENTS.md`.

## Scope And Status

`@reef/jira-migrator` owns operator-run Jira read paths, migration config
loading, dry-run/report helpers, Jira payload normalization, local account
mapping artifacts, source-system ordering plans, and immutable issue import
plans for generic Jira projects. SHDEV/SDDEV are validation fixtures rather
than API naming boundaries.

The package is intentionally outside `@reef/web`: Jira credentials are
deployment/operator secrets, not user state in the product runtime. Keep the
package read-only against Jira unless a later issue explicitly adds a write or
import mapping phase.

The CLI validates configuration and prints a redacted public config. The
library can build issue import plans, but it does not apply them or write to
Jira or Reef.

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

## Verifiable Raw Archive

The raw archive preserves the JSON value returned by `Response.json()` before
Jira payload schemas or normalizers run. It is not a byte-for-byte HTTP capture:
headers, compression, whitespace, and original object-key order are excluded.
The archive uses RFC 8785 JSON Canonicalization Scheme (JCS) bytes and SHA-256
content addresses so equivalent JSON objects share one immutable object while
array order remains significant.

### Private Local Storage

- Use an operator-owned directory on an encrypted local volume outside the
  repository. Network shares, synchronized folders, and filesystems without
  reliable exclusive-create and atomic-rename semantics are unsupported.
- On POSIX, the archive creates and verifies directories as `0700` and files as
  `0600`. An existing symlink or group/other-accessible artifact fails closed.
- On Windows, configure a dedicated-user ACL first and supply the verifier name
  and timestamp through the `external_acl` acknowledgement. The writer refuses
  to start without it because Node file modes cannot prove the Windows ACL.
- `/artifacts/` is ignored at the repository root as a secondary commit guard.
  It is not the recommended archive root.

Each new run requires an explicit retention owner, a future `retention_until`,
and an organization policy reference. There is deliberately no default
retention period. Review archive access and expiry against that policy before
every apply or resume operation.

### Archive And Reference Contract

```ts
import { createRawArchive } from "@reef/jira-migrator";

const archive = createRawArchive({
  root: "/encrypted/private/reef-jira-archive",
  runId: "migration-2026-07-10",
  sourceScope: { cloud_id: "cloud-id", project_key: "PROJECT" },
  createdAt: new Date().toISOString(),
  retention: {
    owner: "migration-operator",
    retention_until: "2026-10-10T00:00:00.000Z",
    policy_ref: "organization-retention-policy",
  },
  permissionVerification: { kind: "posix_mode", verified: true },
  forbiddenSecretValues: [jiraToken, secretFileContents],
});

const reference = await archive.archive({
  entityKind: "issue",
  sourceIdentity: { cloud_id: "cloud-id", project_key: "PROJECT", issue_id: "10001" },
  sourceEndpoint: { method: "GET", pathname: "/rest/api/3/issue/10001" },
  classification: "restricted_pii",
  fetchedAt: new Date().toISOString(),
  payload: jiraResult.raw,
});
// { runId, entryId, contentSha256 }
```

REEF-318 field results and REEF-392 changelog classifications store this opaque
reference. REEF-319 later persists the same reference in its ledger, and
REEF-321 passes it through report/apply/resume orchestration. None of those
surfaces should duplicate or stringify the raw payload. `readRawArchiveReference`
and `verifyRawArchive` validate the envelope version, manifest checksum,
reference, object presence, byte size, object digest, canonical JSON, file
permissions, and lock state before returning data or an apply-ready summary.

Source endpoint metadata contains only `GET`, a pathname, and optional
allowlisted `start_at`, `max_results`, and `next_page_token` pagination values.
Origins, arbitrary query strings, request
headers, `Authorization`, `Cookie`, and `Set-Cookie` are rejected. Configured
non-empty secret values are checked against payload and manifest metadata before
the first archive file is created. Jira account ids, email addresses, watcher
lists, and attachment URLs are not silently redacted; classify them as
`restricted_pii` and protect them with the private storage boundary.

Every source identity includes `cloud_id`; its value must match the archive
source scope. The remaining required fields are part of the public API through
`RawArchiveSourceIdentityByKind` and
`RAW_ARCHIVE_SOURCE_IDENTITY_REQUIRED_KEYS`:

| Entity kind | Additional required identity fields |
| --- | --- |
| `issue` | `project_key`, `issue_id` |
| `description_adf` | `issue_id`, `entity_kind: "description_adf"` |
| `changelog_history` | `issue_id`, `history_id` |
| `watcher_list` | `issue_id`, `entity_kind: "watcher_list"` |
| `comment_source` | `issue_id`, `comment_id` |
| `attachment_source` | `attachment_id` |
| `remote_link` | `issue_id`, `remote_link_id` |
| `custom_field` | `issue_id`, `entity_kind: "custom_field"`, `field_id` |

When present, `project_key` must match the archive source scope, and
`entity_kind` must match the input entity kind. Missing, empty, or mismatched
identity fields fail with `invalid_source_metadata` before the archive root is
created.

### Failure, Recovery, And Disposal

Stable failure codes include `secret_material_detected`, `lock_conflict`,
`permission_violation`, `symlink_not_allowed`, `manifest_checksum_mismatch`,
`object_missing`, `object_size_mismatch`, `object_checksum_mismatch`,
`object_malformed_json`, and `unsupported_schema_version`. Errors contain the
code only, never payload, source URL, account data, or a matched secret.

Manifest updates use a `.manifest.lock`, an exclusive private temporary file,
flush, atomic replacement, and immediate readback verification. If a process
dies and leaves a stale lock, stop all writers, verify the archive and intended
run, preserve evidence needed by the incident process, and only then remove the
lock manually. The writer never deletes a stale lock automatically. Missing or
corrupt objects/manifests must be restored from an approved encrypted backup or
recaptured from Jira into a new run; do not edit checksums to make validation
pass.

At retention expiry, stop the migrator and writer, confirm that no lock exists,
identify the exact run and shared content objects covered by policy, and follow
the organization's approved sanitization procedure. Prefer encrypted-volume key
destruction or another method selected under
[NIST SP 800-88 Rev. 2](https://csrc.nist.gov/pubs/sp/800/88/r2/final).
Ordinary file deletion must not be represented as guaranteed physical erasure.

## Jira Account Mapping

Jira Cloud issue payloads identify people by `accountId`. The migrator maps
those account ids to Reef actors in this order:

1. Operator overrides in the account mapping artifact.
2. Email-directory matches when Jira exposes an email address.
3. Existing artifact records from a previous migration scan.
4. A stable fallback actor, `jira:<accountId>`.

Assignee, reporter, requester, creator, ADF mention, comment-author, and
changelog contexts all use this resolver. Serialized issue plans retain only a
safe `{context, actor, strategy}` summary; account ids, email addresses,
display names, and full Jira account objects stay in the private mapping/raw
artifacts.

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
schemas still reject caller-supplied rank. Trusted Jira importers may seed
`rank` while creating imported issues.

The project-neutral mapping policy is:

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

## Jira Issue Import Plans

`buildJiraIssueImportPlan()` is a pure mapping boundary. It accepts one parsed
Jira issue, a tenant field-catalog snapshot, explicit status/type/priority
policies, the REEF-391 account artifact, REEF-402 target mappings, a batch Jira
key-to-Reef-id map, an optional generic Rank plan, and REEF-406 opaque archive
references. It returns a deeply frozen `schema_version: 1` plan; it never reads
the network or filesystem and never writes Jira, AKB, planning rows, or archive
objects.

### Field Catalog And Enum Policy

Canonical custom roles are `sprint`, `story_points`, `start_date`, and `rank`.
Resolve them in this order:

1. An explicit field-id override that exists in the current catalog and has a
   compatible schema.
2. An exact Jira schema custom key plus compatible type.
3. A normalized exact field name or clause alias plus compatible type.

Substring and fuzzy matching are prohibited. Missing fields report
`field_unresolved`; multiple exact candidates report `field_ambiguous`; an
absent or incompatible override reports `field_override_invalid`. Ambiguity
and invalid overrides block the plan instead of choosing a candidate.

Status, issue type, and priority policies match exact source ids or normalized
exact names. Status alone may fall back to an explicitly configured Jira status
category. An unknown required status or issue type blocks the plan; unknown
priority remains null and is preserved with a warning rather than becoming an
arbitrary `medium`. Closed mappings must supply the Reef close reason, and
`resolutiondate` is the historical `closed_at` candidate.

### Description, Planning, Parent, And Rank

ADF traversal preserves node, mark, and content order and covers paragraphs,
headings, lists/tasks, quotes, code, tables, links, mentions, emoji, cards,
status/expand, rules, and media variants. Unsupported nodes retain their exact
path and type as `description_node_unsupported`. Media becomes a stable
placeholder containing only source media identifiers and an opaque archive
reference; REEF-320 owns its eventual rewrite.

Issue planning consumes only `buildJiraPlanningTargetMappings()` output. One
Version or Sprint relation may be primary automatically; multiple relations
need an explicit source-key primary, otherwise every relation remains in the
report as `owner_decision_required`. A selected relation without a target UUID
is deferred as `needs_release_mapping` or `needs_sprint_mapping`. No planning
entity is created by issue mapping.

Parents resolve from the batch Jira-key-to-Reef-id map. Unresolved same-project
parents use `needs_parent_reconcile`; cross-project parents use
`cross_project_reconcile`. Jira subtasks map to Reef `task` and require a parent.
Rank consumes `buildJiraRankImportPlan()` output; missing and duplicate values
retain the existing `rank_unmapped` classification. Rank APIs are tenant-neutral
and do not expose project-specific aliases.

### Plan Safety And Report Interpretation

Every source field result is `mapped`, `preserved`, `deferred`, `unsupported`,
or `blocked` and names its target or preservation location. Compact Jira
provenance is deep-merged so enum, account, planning, and Rank fragments cannot
overwrite one another. Full issue JSON, raw ADF, watcher payloads, email
addresses, and complete Jira account objects are prohibited from serialized
plans and reports.

A raw issue reference is required for every plan. ADF, watcher, and media
references are additionally required when those payloads exist. Missing one
produces `raw_archive_reference_missing` and a blocked plan. Blocked plans carry
no `desired.issue`, preventing callers from applying a fabricated required
field. Ready plans validate `desired.issue` with the public core
`IssueMetadataSchema`.

`desired.issue.created_at` and `updated_at` use the caller-supplied run timestamp
only to satisfy runtime validation. `projectJiraIssueEventualWrite()` removes
both fields before REEF-321 write projection. Original Jira `created` and
`updated` remain under compact provenance/raw archive and never overwrite AKB's
automatic timestamps. REEF-319 owns ledger/checkpoint decisions; REEF-320 owns
comments/files/link rewrites; REEF-392 owns changelog import; REEF-321 owns the
apply runner.
