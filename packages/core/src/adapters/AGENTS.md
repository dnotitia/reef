# `core/src/adapters` — Adapter Rules

## Adapter scope

`core` contains only the concrete AKB adapter. Provider-specific GitHub and LLM
adapters, credential resolution, and agent runtime code live under the
server-only `packages/web/src/server/` tree and must not be reintroduced here.

## AKB Adapter (`akb/`)

- Owns all managed-workspace issue, template, planning, config, and activity
  reads/writes.
- A reef issue is two linked records: an akb task document for the
  plain-markdown body and akb-native fields, plus a `reef_issues` row for the
  queryable projection. Keep row/document writes paired.
- Issue templates are table-only rows in `reef_templates`, addressed by their
  `name` stem; they are not searchable akb documents.
- `ensureReefTables` only creates missing Reef tables and verifies existing
  tables against the desired manifest; it never alters an existing table from a
  read or hot path. Existing-table evolution runs only in the release pre-start
  gate: enumerate every workspace from the authoritative inventory, apply its
  pending phases through `akbApplyTableMigration`, then call
  `ensureReefTables` for final manifest/version verification. Any workspace
  failure blocks startup/readiness. Never migrate from user requests,
  issue/comment/activity paths, individual workspace entry, or hot reload;
  `akbAlterTable` stays a low-level primitive.
  Use `meta`/`payload` JSON for ad-hoc fields; promote a field to a typed column
  only for filtering, sorting, joins, constraints/uniqueness, or indexing, then
  follow `docs/migration-policy.md`'s Expand → Backfill → Enforce → Contract
  policy.
- Writes are last-write-wins and non-transactional across document + row.
  `writeIssue` compensates a failed row insert by deleting the just-created
  document, and `updateIssue` compensates a failed row update by re-PATCHing the
  document back; keep that compensation-saga model. Do not add CAS / version
  plumbing on the `reef_issues` *row* (no `sha` / `expectedHeadOid` / version
  column), and do not try to make the document+row pair a CAS-coordinated
  transaction.
- The one sanctioned concurrency check is document-level OCC: `updateIssue` may
  forward the caller's base commit as akb's existing `expected_commit`
  precondition on the *document* PATCH, so a concurrent external edit to a
  document-projected field (body, title, labels→tags,
  depends_on/blocks/related_to→relations) is rejected as a retryable
  `ConflictError` instead of silently overwritten (REEF-227). This uses a
  capability akb already provides — it is not new row/cross-store plumbing.
  Row-only scalar fields (status, priority, assignee, dates, planning ids,
  estimate, severity, parent) stay last-write-wins with server-side read-merge.
- In the web request path, `createAkbAdapter({ ... })` is constructed per
  request from the `__reef_session` cookie and forwards
  `Authorization: Bearer <akb-jwt>` to `AKB_BACKEND_URL`. Operator and worker
  runtimes may construct the same public adapter from deployment-managed
  credentials; they must not import web cookie helpers.
