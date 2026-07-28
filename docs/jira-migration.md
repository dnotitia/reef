# Jira Migration

This is the canonical operator runbook and migration policy document for
one-shot Jira-to-Reef migrations. Package-local orientation stays in
`packages/jira-migrator/README.md`.

## Scope And Status

`@reef/jira-migrator` owns the complete operator-run, planning-first Jira
migration: read-only multi-project Jira discovery, private raw archives and
account mapping, dry-run approval reports, AKB apply/readback, durable
checkpoint/resume, related-data reconciliation, changelog promotion, and
sanitized conservation reporting. Project keys remain operator inputs rather
than API naming boundaries.

The package is intentionally outside `@reef/web`: Jira credentials are
deployment/operator secrets, not user state in the product runtime. Jira is
always a read-only source: its client uses GET-only HTTP operations. An apply
stage writes or reconciles Reef targets through an explicit target contract; it
never mutates Jira.

The CLI never writes Jira. In `--apply` it writes Reef only through the public
`@reef/core` AKB adapter and only for the exact plan hash approved by a
completed dry run.

## Documentation Placement

- `packages/jira-migrator/README.md` is the package entry point: purpose, quick
  start, commands, exported surfaces, and links.
- This file owns operator procedures, source-to-target mapping policy, report
  interpretation, account mapping, security handling, and Jira-to-Reef migration
  decisions.
- CLI flag, environment variable, or secret-loading changes must update both the
  package README and this runbook.
- Migration semantics, provenance shape, field mapping, or report
  classification changes must update this runbook beside code and tests.

## Operator Runbook

Use private `0700` artifact directories and `0600` policy/secret files. Run the
dry run from the repository root:

```bash
pnpm --filter @reef/jira-migrator run start -- \
  --jira-base-url https://example.atlassian.net \
  --jira-cloud-id cloud-id \
  --project-key ALPHA \
  --project-key BETA \
  --mapping-policy ALPHA=/private/jira/alpha-policy.json \
  --mapping-policy BETA=/private/jira/beta-policy.json \
  --board-id 42 \
  --akb-base-url https://akb.example.internal \
  --vault reef-test \
  --run-id jira-2026-07-23 \
  --ledger-path /private/jira/ledger.json \
  --archive-root /private/jira/archive \
  --account-mapping-path /private/jira/accounts.json \
  --report-path /private/jira/report.json \
  --dry-run
```

Review the report, retain its checksum, and run `--apply` with the identical
scope plus `--expected-plan-sha256 <report plan_sha256>`. To resume, use the
same files and `--resume <run-id>` in a fresh process. Never edit a report,
ledger, or archive between approval and apply; stale content, a sibling lock,
unsafe permissions, a symlink, target actor/vault drift, or a changed plan
fails closed.

### Post-Apply Closeout

Do not close a migration smoke test merely because the apply process exited
successfully. Verify that the selected run is `completed`, that
`conservation.balanced` is true, and that `failed`, `conflict`, and `retryable`
are all zero. Read the target back independently and compare the expected issue,
parent, comment, attachment, relation, external-reference, and promoted-activity
counts. Download imported attachments through the target read path and compare
their byte length and SHA-256 digest with the archived Jira source bytes.

For a smoke test, finish with a new run id over the same source scope, target,
mapping policy, account mapping, and durable ledger. Produce and approve a new
dry-run plan, then apply it. When Jira business state and target readback are
unchanged, the convergence run must report zero `created`, `updated`, `failed`,
`conflict`, and `retryable`, with every classified input reported as
`skipped`. In this result, `skipped` is a successful idempotent no-op: the
source entity was found in the target with matching mapped state and readback.
It does not mean omitted, unsupported, deferred, or unprocessed.

When an installed build is used, the binary name is:

```bash
reef-jira-migrator --project-key PROJECT --vault reef-test --dry-run
```

## Configuration

The package loads non-secret settings from CLI flags or environment variables.
Credentials come only from environment variables or local secret files.

| CLI flag | Environment variable | Purpose |
| --- | --- | --- |
| `--jira-base-url` | `REEF_JIRA_BASE_URL` or `JIRA_BASE_URL` | Jira tenant URL. Must be HTTPS. |
| `--jira-cloud-id` | `REEF_JIRA_CLOUD_ID` or `JIRA_CLOUD_ID` | Atlassian Cloud id. When no base URL is supplied, it derives `https://api.atlassian.com/ex/jira/<cloudId>`. |
| `--project-key` | `REEF_JIRA_PROJECT_KEY` or `JIRA_PROJECT_KEY` | Repeatable Jira project key, normalized to uppercase. It must start with `A-Z` and then use only `A-Z`, `0-9`, or `_`, so keys such as `SAASV31` are valid. |
| `--board-id` | — | Repeatable explicit board selection; no board inference. |
| `--mapping-policy PROJECT=PATH` | — | Required private JSON mapping policy for every selected project. |
| `--akb-base-url` | `AKB_BACKEND_URL` | HTTPS AKB API origin. |
| `--vault` | `REEF_JIRA_MIGRATOR_VAULT`, `REEF_ORCHESTRATOR_VAULT`, or `REEF_VAULT` | Target Reef workspace vault. |
| `--run-id` | — | Stable execution identity shared by dry-run/apply/resume. |
| `--ledger-path` | `REEF_JIRA_LEDGER_PATH` | Required private checkpoint ledger. |
| `--archive-root` | `REEF_JIRA_ARCHIVE_ROOT` | Required private raw archive root. |
| `--report-path` | `REEF_JIRA_MIGRATOR_REPORT_PATH` | Required private latest-result path; dry-run seals immutable `.approval.json` and `.plan.json` sidecars for apply validation. |
| `--account-mapping-path` | `REEF_JIRA_ACCOUNT_MAPPING_PATH` | Required private Jira account mapping artifact. |
| `--resume` | — | Resume the named run from confirmed entity checkpoints. |
| `--expected-plan-sha256` | — | Required apply approval hash from the dry-run report. |
| `--attest-comment-catalog-complete` | — | Explicitly attest that the Jira credential sees the complete comment catalog. Required for attachment import and destructive reconciliation of omitted comments; repeat on dry-run and apply. |
| `--api-token-file` | `REEF_JIRA_API_TOKEN_FILE` or `JIRA_API_TOKEN_FILE` | Local secret file containing a Jira API token for basic auth. |
| `--bearer-token-file` | `REEF_JIRA_BEARER_TOKEN_FILE` or `JIRA_BEARER_TOKEN_FILE` | Local secret file containing a Jira bearer token. |
| `--akb-jwt-file` | `REEF_AKB_JWT_FILE` | Local secret file containing the AKB JWT. |
| `--dry-run` / `--apply` | — | Exactly one execution mode is mandatory. |

Basic auth uses `REEF_JIRA_EMAIL` or `JIRA_EMAIL` plus one of
`REEF_JIRA_API_TOKEN`, `JIRA_API_TOKEN`, `REEF_JIRA_API_TOKEN_FILE`, or
`JIRA_API_TOKEN_FILE`.

Bearer auth uses one of `REEF_JIRA_BEARER_TOKEN`, `JIRA_BEARER_TOKEN`,
`REEF_JIRA_BEARER_TOKEN_FILE`, or `JIRA_BEARER_TOKEN_FILE`.

Configure either basic auth or bearer auth, not both.

## Execution And Report Contract

The runner reads complete issue projections from enhanced JQL pages by
`nextPageToken`, only the explicitly selected boards, project Versions,
comments, remote links, and every changelog page. The complete projection is
required so descriptions, parents, priorities, attachments, links, and
tenant-specific mapped fields cannot disappear merely because the search
request omitted them. Jira requests are GET-only. It archives exact source JSON
before normalization, maps accounts and planning entities, reserves
deterministic target issue identities, then fingerprints the complete
issue/related/changelog plan.

Approval projections normalize runner-generated retrieval, observation, and
migration timestamps; opaque enhanced-JQL pagination cursors; raw-archive run
ids; Jira field-catalog ordering; and the separately documented request-volatile
development-summary identifiers. These values naturally differ between dry-run
and apply and do not describe target business state. Exact source responses
remain in the private raw archive, while mapped issue content, relationships,
archive entry identities and content digests, and every other stable source
value remain approval-bound.

Dry-run performs the same bounded source reads and validation as apply but
makes zero target mutations. Apply revalidates source scope, target vault and
actor, report approval, and the plan SHA-256. Each successful target write is
read back before its binding and entity checkpoint are atomically persisted.
Independent entity failures remain isolated and reports classify every input
exactly once; `conservation.balanced` must be true.

Related-data execution isolates both retryable transport failures and
deterministic fail-closed errors to the current Jira issue. Retryable errors are
reported as `failed`; non-retryable approval, precondition, or target conflicts
are reported as `conflict`. Neither class confirms an unverified binding, and a
single related issue cannot prevent remaining issues from being classified.

AKB query readback can briefly lag a committed planning or issue mutation. The
target adapter therefore performs a bounded exact-state readback after those
writes and retries idempotent Jira-owner issue reservations across that window.
If the claim endpoint reports a conflict, an independent row read may accept
the claim only when the target id, document URI, and stable Jira cloud/issue
owner all match. A different owner remains a hard conflict, while an ownership
read failure remains unconfirmed and retryable.
It never confirms an ambiguous result from timing alone: the complete approved
projection and issue body must become readable before a ledger binding is
written. If the bounded readback does not converge, apply remains failed or
conflicted and resume retries from the durable checkpoint. Nullable planning
fields omitted by the AKB read model are projected back to the requested
`null` before exact comparison; no unrelated missing field is normalized.

Target preflight reads the Reef workspace configuration and uses its
`project_prefix` for every planned issue id. An uninitialized vault or a prefix
change between dry-run and apply fails closed through target preflight or plan
fingerprint validation; the migrator does not fall back to a hard-coded prefix.
The prefix follows the same Jira-compatible contract as the source project key:
an uppercase ASCII letter followed by uppercase letters, digits, or underscores.

The private plan seals an ordered, hashed related-operation manifest covering
comment, attachment, description, relation, and external-reference writes and
deletions. A freshly computed apply plan must be a subset of that manifest:
different operation identities or mapped inputs fail before mutation. Missing
operations are accepted only as resume convergence when the same importer
readback classifies the approved operation as already complete.

Related data is reconciled after issue creation. A relation is owned by the Jira
issue whose explicit link catalog contained it; processing the other endpoint
must not delete that source-owned binding. Changelog histories are always
preserved raw, with only lossless mapped items promoted to idempotent activity
or external references.

Enhanced-JQL absence alone never authorizes relation deletion because issue
security, credential changes, or project movement can produce the same absence.
The runner preserves that relation and reports a conflict. Apply also validates
the approval-time target projection before an issue update, so independently
edited mapped fields are not overwritten.

The report contains safe identities, fingerprints, counts, opaque archive
references, classifications, and approval metadata. It omits raw payloads,
credentials, email/display-name account data, internal hostnames, and local
archive paths. Related-data dry-run reports count each planned target deletion
without performing it, and classify a planned description media rewrite as an
update; apply counts only deletions that completed successfully. Validate the
built contract with:

```bash
pnpm --filter @reef/jira-migrator run test:behavior
```

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
  The bundled Jira CLI has no attestation input and therefore refuses Windows
  archive creation instead of manufacturing this acknowledgement.
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

Use `archiveMany(inputs)` for a migration phase with many source entities. It
holds the same exclusive manifest lock, verifies each content-addressed object
as it is written, atomically replaces the manifest once, and then verifies the
complete envelope and object set once. `archive(input)` remains the one-item
equivalent.

Field-mapping results and changelog classifications store this opaque
reference. The migration ledger persists the same reference, and the apply
runner passes it through report/apply/resume orchestration. None of those
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

The email directory is the target vault's member roster, not AKB's global user
directory. An operator override must also name a current member of the target
vault; otherwise preflight fails with
`account_mapping_actor_not_vault_member` before archiving, planning, or target
mutation. Add the user to the vault explicitly or remove the override and
review the stable Jira fallback—global account existence alone is insufficient.

### Vault Membership Preparation

Prepare target membership after Jira discovery identifies the people in scope
and before producing the approval dry-run:

1. Create and initialize the target Reef vault.
2. Discover the selected Jira projects and collect their user observations.
3. Compare the Jira users and proposed overrides with the target vault member
   roster.
4. For each gap, explicitly grant an appropriate vault role or retain the
   stable `jira:<accountId>` fallback.
5. Run the approval dry-run only after membership decisions are complete.
6. Apply with the same artifacts and approval hash. Apply re-reads the member
   roster and fails closed if an email or override actor is no longer a member.

Do not grant vault access automatically from Jira participation. Appearing as
an assignee, reporter, creator, commenter, or changelog actor does not establish
authorization to read a private Reef vault. The migrator therefore performs no
membership mutation during dry-run or apply; access grants are a separate,
operator-authorized preparation action. In particular, do not add a member
during apply: that would change both access control and account resolution
after the plan was approved.

Use the least privileged role that satisfies the target workflow:

- `reader` preserves a person identity and permits read-only vault access.
- `writer` is appropriate only when the person must edit issues or other vault
  content.
- `admin` is not required for Jira people-field fidelity and should not be
  granted by a migration procedure.

A disposable vault may accept a reviewed membership manifest immediately after
creation when its access list is already known. This is a provisioning
optimization, not a replacement for migration preflight: the approval dry-run
and apply must still validate the current target roster.

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
  --project-key PROJECT \
  --vault reef-test \
  --account-mapping-path ./artifacts/jira-account-mapping.cloud-abc.json \
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
      "projectKeys": ["PROJECT"]
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

The Jira Rank importer maps Jira Rank's current value into reef's existing
`reef_issues.rank` column. The column is the issue-wide numeric ordering
scalar: lower numbers sort earlier, and `NULL` sorts at the ordered tail.

This does not make `rank` a normal user-authored issue field. The product UI
writes it only through backlog drag-to-reorder, and generic issue create/update
schemas still reject caller-supplied rank. Trusted Jira importers may seed
`rank` while creating imported issues.

The Jira Rank mapping policy is:

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

Jira Rank changelog history reconstruction is out of scope. The importer
preserves the current Jira ordering only.

## Jira Version And Sprint Planning Migration

The planning importer treats Jira Version and Sprint records as independent
migration entities. Issue import consumes the resulting Reef UUID mappings; it
does not create releases or sprints itself.

### Read And Selection Policy

- Read the complete paginated Version catalog for every configured source
  project with `JiraReadClient.readProjectVersionCatalog()`.
- Discover the issue Sprint custom field from Jira's field catalog schema with
  `listFields()` and `normalizeIssueSprintReferences()`; do not hard-code a
  `customfield_NNNNN` id.
- Always include Sprint records referenced by in-scope issues.
- Expand Sprint selection only from boards the operator explicitly configured,
  using `readBoardSprintCatalog()`. The board resource itself is archived and
  plan-bound even when Jira identifies it as a `simple` or other non-Scrum
  board whose Sprint endpoint returns HTTP 400; in that case the verified
  Sprint catalog is empty rather than aborting the project migration. A shared
  board is not inferred from a project name.
- Record `configured_project`, `issue_reference`, and `configured_board` in the
  action's selection provenance so dry-run reports explain why each source
  entity is present.

Version identity is `jiraCloudId + projectId + versionId`. Sprint identity is
`jiraCloudId + sprintId`; source names are display and exact-match fallback
values only. The exported identity helpers encode these components into stable
keys suitable for migration ledger records.

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

1. Reuse a migration ledger binding when one exists for the stable source key.
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
After the apply runner executes a create action through `@reef/core`, pass the
returned UUID to `resolveJiraPlanningActionTarget()`. The migration ledger can
persist that resolution by stable source identity, while issue mapping can
consume the release and Sprint maps from `buildJiraPlanningTargetMappings()`
without creating planning rows.

The planning API, action shape, and tests are project-independent and exercise
multiple synthetic project keys with the same contract.

Official API references:

- [Jira project Version REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-versions/)
- [Jira board Sprint REST API](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-sprint-get)

## Jira Changelog Activity Planning

Changelog import is a pure planning step. Archive each complete Jira history
object before validation, then pass that exact object and its opaque
`{runId, entryId, contentSha256}` reference to `buildJiraChangelogPlan()`. The
planner fingerprints the pre-normalization object, verifies the reference, and
returns a deeply frozen plan. Missing or mismatched raw evidence stops planning;
no activity is emitted.

Every item receives exactly one classification: `promoted`, `raw`, `deferred`,
or `failed`. Total and per-field counts must conserve the input item count, and
each history reports exactly one opaque preservation location. Reports may
contain stable field ids and reason codes but must not contain raw authors,
source bodies, account ids, tokens, cookies, or local archive paths.

Lossless promotion follows these rules:

- status, assignee, summary, parent, due date, and labels reuse existing Reef
  activity types after field-id, canonical-role, or configured exact-alias
  resolution; Jira Cloud's exact `IssueParentAssociation` field name is a
  built-in parent alias, while display-name fuzzy matching is forbidden;
- issue type maps to `issue_type_change` only when both values resolve to Reef
  issue types, and Start date maps to `start_date_change` only for valid dates
  or null;
- Fix Version requires an existing Version-to-Release binding; issue links
  require link identity, direction, target binding, and a matching current
  snapshot; remote links require a current snapshot; attachments require the
  imported attachment identity;
- description, Rank, Goals, resolution, Comment, and arbitrary custom fields
  remain raw-only. The planner does not reconstruct description diffs, Rank
  movement, comments, or unsupported custom activity.

Promoted activities carry a caller-supplied migration event key derived from
Jira Cloud id, issue id, history id, item index, and event type. Replay of the
same history therefore reuses the key, while otherwise-identical transitions
from different histories do not collide. Core validates this reserved key
before AKB I/O; ordinary Reef activity callers omit it and retain the existing
value-and-time key calculation. Record the changelog-history source fingerprint
in the migration ledger only after target write/readback succeeds. A changed
fingerprint for an existing binding is a failed conflict, not an overwrite.

The apply runner, bulk changelog API selection, current-object import, and
concurrent-writer database uniqueness remain outside this planning API.

## Migration Ledger And Checkpoint

The migration ledger is the operator-owned local execution-state artifact used
by apply orchestration. It is deliberately separate from the raw archive: the
archive owns canonical source payloads, while the ledger stores only stable
identity, sanitized fingerprints, opaque archive references, successful target
bindings, and immutable run results. The ledger is not stored in reef-web or an
AKB table.

### Scope And Identity

A version 1 ledger has one Jira Cloud `source_scope` and one Reef vault
`target_scope`. Multiple project keys from that Cloud share the same artifact;
opening the same `run_id` with another Cloud, vault, project set, or plan
fingerprint is a conflict. Source names, summaries, project keys, and issue keys
remain display provenance rather than identity:

- Version: Jira Cloud id + project id + Version id.
- Sprint: Jira Cloud id + Sprint id; origin board is provenance.
- Issue: Jira Cloud id + project id + issue id.
- Comment: Jira Cloud id + issue id + comment id.
- Attachment: Jira Cloud id + attachment id.
- Changelog: Jira Cloud id + issue id + history id.
- Relation: source/target issue ids plus stable link type, direction, and id.

Use the exported percent-encoding identity builders. Do not hand-build keys or
fall back to mutable Jira names and keys. `getJiraPlanningLedgerBindings`
adapts confirmed Version/Sprint bindings to the planning API, while issue and
comment lookup helpers return the Reef issue document pair and comment UUID.
Jira `external_refs` remain PM-facing links; they do not provide idempotency.

### Diff, Apply, And Resume

Dry-run and apply must call the same `classifyJiraMigrationDiff` function over
the same normalized fingerprints and target readback evidence:

- no binding is `create`;
- a valid binding with matching desired mapped state and target readback is
  `skip`;
- changed mapped state on the same valid target is `update`;
- a retryable prior failure with unchanged preconditions is `retry`;
- a missing/mismatched bound target, changed retry precondition, or
  non-retryable prior failure is `conflict`.

Mapped-state fingerprints exclude runner-generated issue `created_at` and
`updated_at` values. Changelog mapped-state fingerprints exclude the raw
archive reference's run id while retaining source content identity and the
semantic classification. Approval fingerprints likewise normalize opaque
enhanced-JQL `nextPageToken` values and raw archive run ids while retaining
page contents, archive entry ids, and content digests. A new run id, pagination
cursor, or execution time must therefore remain `skip` when source state and
target readback are unchanged.

The Atlassian development integration field whose schema custom key is
`com.atlassian.jira.plugins.jira-development-integration-plugin:devsummarycf`
contains request-volatile internal identifiers. Its exact response remains in
the verifiable raw archive, but its raw-only value is tokenized in the approval
projection because it does not drive any target mutation. Other custom-field
values remain approval-bound.

Call `confirmJiraMigrationBinding` only after both the target write and target
identity readback succeed. A failed write or readback belongs in the run result,
not in `bindings`; resume then retries or conflicts instead of creating a second
target. Checkpoints are phase plus canonical entity key, never an array index.
The ordered phases are planning, issues, related
(comments/attachments/changelog), and reconciliation. Reordering source input
does not change which completed entities are skipped.

Related-data planning follows that same phase order. When the base issue action
is `create` or `update`, media preconditions are evaluated against the approved
new base description that the issue phase will write first. A `skip` continues
to use current target readback, and a conflict supplies no speculative base
content.

Related operation approval hashes normalize target-generated identifiers.
Comment parent UUIDs use their stable Jira source identity, and attachment links
in both descriptions and comments use their stable Jira attachment identity.
Dry-run placeholder URIs and live AKB file URIs therefore produce the same
approval input only when they refer to the same source attachment.

Cross-project relations persist `pending_target_migration`, `ready`, and
`reconciled` separately. A retryable entity failure leaves its phase
`partial_failed` without blocking unrelated entities; a conflict or
non-retryable failure marks it `blocked`. `buildJiraMigrationReport` derives
created, updated, skipped, conflict, failed, and retryable counts directly from
the selected run, grouped by phase and entity kind; no mutable counter totals
are persisted.

AKB related-data catalog and readback calls use bounded retries for HTTP 429 and
5xx responses. The retry boundary covers reads only; mutations still rely on
their explicit idempotency keys, preconditions, and target readback. If the
read retry budget is exhausted, the report retains `retryable: true` so a
resume can distinguish transient backend availability from deterministic data
conflicts.

Each entity result stores the sanitized source and mapped-state fingerprints
used for its attempt. After restart, retry classification compares those
persisted values with the current source and desired mapped state; changed or
missing preconditions produce `retry_precondition_changed` rather than a retry.
Finalization also leaves a phase open while any successful result lacks
readback or any reconciliation entry remains `pending_target_migration` or
`ready`.

### File Lifecycle And Recovery

Place the artifact in a private operator directory on an encrypted local
volume. POSIX directories must be `0700` and files `0600`. Windows writes need
an explicit external ACL acknowledgement. Synchronized and network filesystems
are unsupported.

`loadJiraMigrationLedger` interprets only `ENOENT` as a new empty v1 artifact.
Malformed JSON, a strict-schema error, unsupported version, scope mismatch,
unsafe permissions, symlink, or sibling lock is a typed fail-closed error and
must not be repaired by overwriting the file. `writeJiraMigrationLedger`
rejects secret-like keys and configured secret values before its first write,
takes an exclusive sibling lock, and then re-reads the current artifact. An
update to an existing artifact must pass the value previously returned by
`loadJiraMigrationLedger` as `expectedLedger`; a missing precondition fails with
`write_precondition_required`, while an intervening committed write fails with
`stale_ledger` instead of being overwritten. After that compare-and-swap check,
the writer writes and flushes a private temporary file, renames it in the same
directory, syncs the directory on POSIX, and immediately reloads the artifact
for readback.

Before apply, copy the unlocked ledger to a private backup and verify that the
copy parses with the same Cloud and vault scopes. After interruption, preserve
the ledger and inspect the selected run report; resume the same run id and plan
fingerprint so only missing or retryable entity keys execute again. Never delete
a stale lock automatically. Confirm no writer is alive, preserve the ledger,
lock, and temporary sibling files as incident evidence, then have the operator
remove only the exact stale lock and reload before retrying. Corruption, scope
drift, run drift, or a missing bound target requires operator investigation or
restoration from the verified backup; do not synthesize a fresh target.

## Jira Issue Import Plans

`buildJiraIssueImportPlan()` is a pure mapping boundary. It accepts one parsed
Jira issue, a tenant field-catalog snapshot, explicit status/type/priority
policies, the account-mapping artifact, planning target mappings, a batch Jira
key-to-Reef-id map, an optional generic Rank plan, and opaque raw-archive
references. It returns a deeply frozen `schema_version: 1` plan; it never reads
the network or filesystem and never writes Jira, AKB, planning rows, or archive
objects.

### Field Catalog And Enum Policy

Canonical custom roles are `sprint`, `story_points`, `start_date`, and `rank`.
Here, "custom" describes Jira's API storage model, not an instruction to import
arbitrary tenant fields. These four allowlisted Jira/Jira Software concepts may
be promoted into existing first-class Reef fields; every other custom field
remains raw-only unless a future migration contract explicitly adds it.

Field-id overrides are an exception path, not normal operator discovery work.
With no override, the migrator must identify each canonical role from Jira's
field catalog. Configure an override only when exact catalog evidence is
ambiguous or a reviewed tenant policy intentionally selects one candidate.
Resolve them in this order:

1. An explicit field-id override that exists in the current catalog and has a
   compatible schema.
2. An exact Jira schema custom key plus compatible type.
3. A normalized exact field name or clause alias plus compatible type.

Jira Cloud may expose the exact LexoRank schema key
`com.pyxis.greenhopper.jira:gh-lexo-rank` with schema type `any` even though
issue values are strings. Treat that exact schema-key combination as compatible
with Rank, then validate each issue value at the mapping boundary. Do not accept
type `any` for unrelated custom fields.

Substring and fuzzy matching are prohibited. Missing fields report
`field_unresolved`; multiple exact candidates report `field_ambiguous`; an
absent or incompatible override reports `field_override_invalid`. Ambiguity
and invalid overrides block the plan instead of choosing a candidate.

Configure tenant-specific ids in the selected project's private mapping policy:

```json
{
  "statuses": [],
  "issueTypes": [],
  "priorities": [],
  "fieldOverrides": {
    "sprint": "customfield_10020",
    "story_points": "customfield_10016",
    "start_date": "customfield_10015",
    "rank": "customfield_10019"
  },
  "linkMappings": []
}
```

The same overrides govern current issue projection and changelog field-role
resolution. Omit roles that resolve unambiguously; never select one tenant
candidate by array order.

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
reference for the later attachment-rewrite pass.

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
field. The runner grounds each description media placeholder in the same
archived ADF object, so the issue projection and later rewrite use identical
opaque provenance. Ready plans validate `desired.issue` with the public core
`IssueMetadataSchema`.

`desired.issue.created_at` and `updated_at` use the caller-supplied run timestamp
only to satisfy runtime validation. `projectJiraIssueEventualWrite()` removes
both fields before apply write projection. Original Jira `created` and
`updated` remain under compact provenance/raw archive and never overwrite AKB's
automatic timestamps. Ledger/checkpoint decisions, comments/files/link
rewrites, changelog import, and apply execution remain separate migration
responsibilities.

## Comments, Attachments, Media, And Links

`importJiraRelatedData()` is the exported per-issue stage used after the issue
itself has a Reef target. It does not enumerate projects or provide the final
CLI runner. Dry-run reads Jira and returns a structured report but invokes no
target mutation. Apply handles each entity independently and confirms ledger
bindings only after target readback.

Comment pages always request `expand=properties`. A top-level `parentId` may be
a number or string and is normalized to one decimal string identity. Roots are
written before replies; a reply resolves its parent through the comment ledger
and uses Reef's threaded-comment contract. Missing parents are isolated as
entity failures and never become flat comments. Source author mapping and
created/edited timestamps are preserved.

Attachments are downloaded only with a GET to the configured Jira origin at
`/rest/api/3/attachment/content/{id}?redirect=false`. The importer never follows
the payload's arbitrary `content` URL with Jira credentials. It verifies source
size, stored file bytes, attachment metadata, original Jira id, and file URI
readback before confirming the ledger binding. AKB storage uses the backend's
presigned contract: initiate under `/api/v1/files/{vault}/upload`, PUT the exact
bytes to the returned storage URL with its signed MIME type, confirm the
content hash under `/api/v1/files/{vault}/{file_id}/confirm`, and use the
matching presigned download endpoint for readback. The migrator does not assume
that AKB exposes a direct multipart upload or authenticated byte-stream route.
Treat presigned upload and download URLs as ephemeral credentials: never log,
archive, or serialize them into a report, ledger, plan, issue body, or error.
Wildcard, malformed, and generic MIME headers are not persisted as authoritative
types: the importer next checks file signatures, then known filename
extensions, and finally falls back to `application/octet-stream`. A rerun that
finds a bound attachment with different normalized metadata or bytes revokes
that target and recreates it before confirming the new binding. The repair plan
retains every replaced file URI only as an approved description-rewrite
precondition so ADF media references to stale files converge on the recreated
attachment; those stale URIs are not treated as live bindings.

Issue discovery requests both `properties` and `renderedFields`. ADF `media`
and `mediaInline` nodes resolve after attachment import in this fixed order:
a unique issue attachment filename (including an exact non-empty ADF `alt`
match), the issue's sole attachment, a rendered-field element that pairs the
media id with an attachment REST href/name, then a rendered-description
filename that uniquely contains the media id. Contradictory rendered and ADF
evidence, zero candidates, or multiple candidates remain unresolved; the
importer never guesses from numeric equality or array order. Issue planning
and description rewriting use the same raw-archive and account-mapping
conversion options, preventing a valid rewrite from failing its Markdown
precondition.

Standard links deduplicate on Jira link id. Operators configure an exact link
type triple (`id`, `name`, `inward`, `outward`) as directional or symmetric;
tenant labels are not built into the package. Directional mappings explicitly
declare the Reef relation for both the outward and inward side rather than
inferring meaning from display labels; symmetric mappings produce `related_to`.
The importer canonicalizes each directional edge as Jira outward endpoint to
inward endpoint before applying both relations, so project traversal order
cannot choose the stored orientation.
Unknown or not-yet-migrated endpoints remain Jira external refs
with reconciliation provenance. When the link type has an explicit operator
mapping, this externalization is a successful cross-project reconciliation;
the report keeps `externalized` separate from `unmapped`, and only the latter
remains a policy conflict. Remote links are a separate reader and use
`globalId`, or a canonical content hash when absent, while preserving URL,
title, application, relationship, and object provenance.

Reports contain only aggregate counts and safe source identities, phase,
retryability, and reason. They must not contain credentials, source response
bodies, account details, filenames, or authorization headers. Jira remains
GET-only. This change requires no AKB schema migration or backfill; it reuses
the existing threaded-comment and attachment metadata envelopes.
