# `core/src/adapters` — Adapter Rules

## akb Adapter (`akb/`)

- Owns all managed-workspace issue, template, planning, config, and activity
  reads/writes.
- A reef issue is two linked records: an akb task document for the
  plain-markdown body and akb-native fields, plus a `reef_issues` row for the
  queryable projection. Keep row/document writes paired.
- Issue templates are table-only rows in `reef_templates`, addressed by their
  `name` stem; they are not searchable akb documents.
- `reconcileWorkspaceSchema` is a mutation primitive owned only by explicit
  workspace initialization and the release pre-start migration service.
  `verifyWorkspaceSchema` is the read-only consumer for every feature path.
  Existing-table evolution runs only in the release pre-start gate: enumerate
  every registered workspace from the authoritative marker/member inventory,
  apply pending phases through `akbApplyTableMigration`, reconcile missing
  tables, then verify the exact manifest/version. Any workspace failure blocks
  startup/readiness. Never reconcile or migrate from issue, comment, activity,
  config, template, workspace-entry, or hot-reload paths; `akbAlterTable` stays
  a low-level primitive. The architecture guard test owns the two-call-site
  allowlist.
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
- `createAkbAdapter({ ... })` is constructed per request from the
  `__reef_session` cookie and forwards `Authorization: Bearer <pat>` to
  `AKB_BACKEND_URL`.

## GitHub Adapter (`github.ts`)

- Monitored-repo grounding only: activity detection, `search_code`,
  `dev_read_file`, and `list_repo_labels`.
- Read-only. No managed-repo writes, no local Git, and no cloning.
- Keep `createGitHubAdapter` / `listLabelsForRepo` as the only value exports of
  `github.ts`, plus their supporting type interfaces.
- The deployment-managed GitHub App credential provider lives in
  `github/appAuth.ts` and exports `createGitHubAppInstallationTokenProvider`
  (App JWT → installation token). It feeds the same `createGitHubAdapter`
  via a token string; it is an alternative token source to the per-user browser
  PAT, not a second adapter. The minted token is down-scoped to read-only
  permissions (`contents`/`metadata`/`pull_requests` read) so it stays read-only
  even if the App was granted write — the App permission set is not the only
  guardrail. The private key, App JWT, and minted token must stay out of logs,
  span attributes, prompts, and responses — record only the App and installation
  ids and the token expiry, and normalize failures to a credential-free
  `GitHubApiError`.

## LLM Adapter (`llm.ts`)

- LLM configuration is deployment-managed server state. Core receives one
  provider-neutral OpenAI-compatible endpoint and must not infer or interpret a
  provider or platform deployment mode.
- Every model step uses Chat Completions, a fresh UUID `Idempotency-Key`, and
  zero AI SDK retries. This is Reef's endpoint-independent request contract.
- Keep provider errors credential-free when surfacing or logging them; preserve
  useful status and response detail only through safe error types.
