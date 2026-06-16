# `core/src/schemas/issues` — Issue Schema Rules

- `IssueMetadataSchema` is canonical. Issue list/detail/create/update/proposal,
  tool, and enrichment schemas must derive from it; do not reintroduce
  `IssueSchema` or independently redefine issue fields.
- New issue fields start here. Give each field one storage home: akb-native
  document field, `reef_issues` typed column when filtering or sorting is needed,
  or the row `meta` JSON for ad-hoc fields.
- Issue field display metadata lives in `fieldRegistry.ts` and is exported via
  `@reef/core/fields`; keep it pure TypeScript, with no React or Tailwind.
- When adding or changing issue fields, audit the full field pipeline: core
  schemas and akb storage, Route Handler contracts, field display metadata and
  web leaves, AI draft/enrichment schemas and prompts, activity-scan
  suggestion/approval paths, chat/tool descriptors, fixtures/evals, and the
  workspace vault-skill when authoring conventions or SQL runbooks change.
