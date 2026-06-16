// ─── akb adapter shared internals (compat barrel) ──────────────────────
//
// This file was a single 1500-line module; it is now a thin re-export barrel so
// the adapter's siblings (`issues.ts`, `planning.ts`, `config.ts`, …) and the
// co-located tests keep importing from `./shared` unchanged. The implementation
// is split by responsibility:
//
//   constants.ts  — collection + table-name identity (no imports)
//   tracing.ts    — `withSpan` OTel wrapper
//   paths.ts      — slugify / path / resource-label helpers
//   http.ts       — `AkbAdapter`, request factory, document/search envelopes
//   sql.ts        — SQL quoting, `runSql`, response schemas, value decode
//   tables.ts     — table provisioning (`ensureReefTables`)
//   issueRows.ts  — `reef_issues` row ↔ Issue mapping + row reads/writes
//   issueQuery.ts — issue-list WHERE / ORDER BY / keyset cursor / default view
//   documents.ts  — akb document search / delete / put-body / response guards
//
// Prefer importing from the specific module above in NEW code; this barrel
// exists for older import support.

export * from "./constants";
export * from "./documents";
export * from "./http";
export * from "../issues/issueQuery";
export * from "../issues/issueRows";
export * from "./paths";
export * from "./sql";
export * from "./tables";
export * from "./tracing";
