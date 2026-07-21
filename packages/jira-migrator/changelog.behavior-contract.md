# Jira Changelog Import Behavior Contract (REEF-392)

## User-Visible Goal

Jira migration operators can preserve every changelog history in the verified
raw archive, promote only losslessly mapped changes into Reef activity plans,
and audit the resulting classification totals without exposing credentials or
source PII. Reef users can read the two newly supported activity types in both
English and Korean.

## Target

- Type: public `@reef/jira-migrator` and `@reef/core` package APIs plus the
  hermetic Reef web app.
- Build/access: `pnpm --filter @reef/jira-migrator run build`, a source-blind
  Node harness importing only published package exports, and
  `http://localhost:7353` from `pnpm --filter @reef/web run dev:e2e`.
- Allowed fixtures: generated Jira histories containing synthetic ids, dates,
  actor handles, field catalog entries, bindings, current link snapshots, and
  raw archive paths under a private `mktemp -d` directory; the checked-in
  hermetic `configured` web scenario.
- Credentials: none. The web scenario uses only its documented fixture login.

## User Tasks

1. Archive a parsed Jira history through the public raw-archive API, retain the
   returned opaque reference, and read it back with checksum verification.
2. Plan supported and unsupported changelog histories through the public
   changelog planner API and inspect the immutable per-item classifications,
   activity/external/reconciliation actions, safe provenance, and report.
3. Replay an unchanged source item and then present a drifted fingerprint to
   the public ledger/planner surface.
4. Append and read activities through the public core adapter surface using a
   validated migration event key, then append an ordinary user event without a
   supplied key.
5. Open the hermetic issue timeline in English and Korean and read one
   `issue_type_change` and one `start_date_change` event in each locale.

## Expected Observable Behavior

- A changelog history is archived before planning. Planning without a valid raw
  archive reference fails closed and does not emit a promotion action.
- Raw readback reproduces the history `id`, `created`, `author`, and every
  item's `field`, `fieldId`, `fieldtype`, `from`, `to`, `fromString`, and
  `toString`, including absent and null variants. The manifest and object
  checksums verify successfully.
- Every input history has exactly one raw archive reference. Every input item
  has exactly one classification: `promoted`, `raw`, `deferred`, or `failed`.
  Report totals and per-field totals add up exactly to the input item count;
  the 6,011-item conservation fixture reports 6,011.
- `status`, `assignee`, `summary`, `parent`, `due date`, and `labels` map to
  existing Reef activity types only when selected by a field id, canonical
  role, or configured exact alias. Display-name fuzzy matching is forbidden.
- `issuetype` maps to `issue_type_change` only when both ends map losslessly to
  Reef issue types. `Start date` maps to `start_date_change` only when both ends
  are an ISO date or null. Unknown or lossy values are never promoted.
- The migration event key is stable for the same
  `cloudId + issueId + historyId + itemIndex + eventType`, differs for a
  different history even when transition values and timestamps match, and is
  rejected by core when malformed. Ordinary user activity still derives its
  existing value-and-time key when no key is supplied.
- Fix Version uses an existing Version-to-Release binding to plan a release
  `planning_link`; a missing binding is `deferred`.
- Jira issue links use configured type identity, inward/outward direction, and
  the current snapshot. A resolved target becomes a relation action; missing
  target/binding/snapshot remains deferred without a fabricated relation.
- Remote/Confluence links use the current remote-link snapshot to plan an
  external reference or reconciliation action. History-only internal metadata
  stays raw and does not appear in the action or report.
- Attachment add/remove uses the existing attachment identity binding. Missing
  identity is deferred.
- `description`, `Rank`, `Goals`, `resolution`, `Comment`, and arbitrary custom
  fields are raw-only and create no comment or activity action.
- An unchanged ledger replay creates no duplicate activity. A changed source
  fingerprint for an already bound history is visible as a conflict/failed
  result and does not mutate the immutable prior activity.
- Returned plans and reports are deeply immutable. Report output contains only
  safe counts, safe field identifiers/reasons, and opaque
  `{runId, entryId, contentSha256}` preservation locations.
- English and Korean timelines render localized sentences for both new event
  types with the same neutral glyph. No raw author object, account id, token,
  cookie, source payload, or local absolute path appears in the page,
  transcript, report, screenshot, logs, or PR evidence.

## Anti-Cheat Probes

- Change only `historyId`; the migration event key must change even if values
  and timestamps are identical. Replay the original item; its key must not.
- Change a configured exact alias to a near/fuzzy display name; the item must
  stop promoting.
- Remove each required binding/snapshot/raw reference in turn; the result must
  be deferred or failed as specified and must not fabricate an action.
- Supply invalid issue types, invalid dates, malformed caller event keys, and a
  drifted bound fingerprint; each must fail closed without partial promotion.
- Reorder report inputs and try mutating nested plan arrays/objects; counts and
  keys stay deterministic and mutation fails or leaves the value unchanged.
- Refresh the English timeline, switch to Korean, and reload; both event rows
  remain present and localized from the fixture-backed API rather than static
  page text.

## Evidence Required

- Redacted source-blind transcript with command, exit code, history/item counts,
  `promoted/raw/deferred/failed` totals, per-field totals, raw verification and
  readback summary, replay result, drift result, and core append/readback result.
- Browser screenshot showing both new events together in English and Korean.
- Browser accessibility/text assertions and attached `dev:e2e` server log
  excerpt showing successful real `/api/*` requests with no secret-bearing
  values.
- Automated focused and full gate results tied to the exact commit under test.

## Acceptance-Criteria Traceability

| AC | Code ownership / observable surface | Automated test | Source-blind proof |
| --- | --- | --- | --- |
| 1 | typed Jira payload + raw archive readback | payload/changelog fixtures | Tasks 1-2 raw readback |
| 2 | planner classification and report conservation | 6,011-item planner fixture | Task 2 totals |
| 3 | existing-event mapping + exact field resolution | planner mapping table tests | exact-vs-fuzzy probe |
| 4 | core union/adapter + web model/row/i18n | core and web focused suites | Tasks 4-5 |
| 5 | migration event-key seam + existing default key | planner and adapter tests | history-id/replay probes |
| 6 | Version-to-Release binding mapper | planner binding fixtures | missing-binding probe |
| 7 | issue-link direction/snapshot mapper | resolved/unresolved link fixtures | missing-target probe |
| 8 | remote-link external reconciliation planner | current-snapshot fixtures | redacted action summary |
| 9 | attachment identity mapper | add/remove/missing fixtures | missing-identity probe |
| 10 | raw-only policy table | policy fixture matrix | zero-action summary |
| 11 | ledger replay and fingerprint conflict | replay/drift tests | Task 3 transcript |
| 12 | field report + opaque location + redaction | report/redaction tests | redacted report summary |
| 13 | bilingual timeline + neutral glyph | component and hermetic E2E | bilingual screenshots |
| 14 | public migrator/core/web contract | focused + full suites | all source-blind tasks |

## Out Of Scope

- The REEF-321 full migration runner/apply orchestration.
- REEF-320 current comment/link/remote-link/attachment import.
- REEF-366 concurrent-writer database uniqueness, bulk changelog API changes,
  Jira description diff reconstruction, historical Rank movement, resolution
  events, or first-class handling for every custom field.

Completion criterion: every user task and anti-cheat probe is pass, fail,
blocked, or explicitly out of scope, with the required redacted evidence.
