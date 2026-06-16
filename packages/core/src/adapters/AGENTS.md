# `core/src/adapters` — Adapter Rules

## akb Adapter (`akb/`)

- Owns all managed-workspace issue, template, planning, config, and activity
  reads/writes.
- A reef issue is two linked records: an akb task document for the
  plain-markdown body and akb-native fields, plus a `reef_issues` row for the
  queryable projection. Keep row/document writes paired.
- Issue templates are table-only rows in `reef_templates`, addressed by their
  `name` stem; they are not searchable akb documents.
- `ensureReefTables` provisions Reef tables for new vaults. Use the row `meta`
  JSON for ad-hoc fields, and promote a field to a typed column only when it must
  be filtered or sorted.
- Writes are last-write-wins and non-transactional across document + row.
  `writeIssue` compensates a failed row insert by deleting the just-created
  document; do not add CAS, `sha`, or `expectedHeadOid` plumbing.
- `createAkbAdapter({ ... })` is constructed per request from the
  `__reef_session` cookie and forwards `Authorization: Bearer <pat>` to
  `AKB_BACKEND_URL`.

## GitHub Adapter (`github.ts`)

- Monitored-repo grounding only: activity detection, `search_code`,
  `dev_read_file`, and `list_repo_labels`.
- Read-only. No managed-repo writes, no local Git, and no cloning.
- Keep `createGitHubAdapter` / `listLabelsForRepo` as the only value exports,
  plus their supporting type interfaces.

## LLM Adapter (`llm.ts`)

- LLM configuration is deployment-managed server state:
  `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, and `REEF_LLM_MODEL`.
- Keep provider errors credential-free when surfacing or logging them; preserve
  useful status and response detail only through safe error types.
