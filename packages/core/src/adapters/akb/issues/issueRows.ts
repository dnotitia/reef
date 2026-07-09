import { ZodError, type z } from "zod";
import { SchemaValidationError } from "../../../errors";
import { RANK_STEP } from "../../../models/backlogRank";
import { observe } from "../../../observability";
import {
  ExternalRefSchema,
  ImplementationRefSchema,
  type IssueMetadata,
  IssueMetadataSchema,
} from "../../../schemas/issues/metadata";
import { REEF_ISSUES_TABLE } from "../core/constants";
import type { AkbAdapter } from "../core/http";
import {
  type AkbSqlResponse,
  decodeSettingsValue,
  isMissingTableError,
  quoteIdent,
  quoteIntOrNull,
  quoteJson,
  quoteNumberOrNull,
  quoteText,
  quoteTextOrNull,
  runSql,
  tableRef,
} from "../core/sql";

// ─── Issue ↔ reef_issues row mapping ──────────────────────────────────────────

/**
 * akb path is `_slugify(title)`, so reef pins `title = issue.id` to keep the
 * path fully derivable from the reef-side identifier (`issuePathFor(id)`).
 * The human-readable issue title is preserved as the akb `summary` field
 * (subtitle in akb's browse view) and in the `reef_issues` table's `title`
 * column — the latter is what reef's UI reads.
 */
export function buildIssueAkbTitle(issue: IssueMetadata): string {
  return issue.id;
}

/**
 * Reef "semantic actor" metadata packed into the `reef_issues.meta` json
 * column. These are application-level labels ("ai-agent", a PM's name, a
 * trigger source) — deliberately distinct from akb's auth-principal
 * `created_by`, so they does not ride on akb-native document fields.
 */
interface IssueRowMeta {
  author: string;
  last_editor: string;
  source: string | null;
  /**
   * ISO timestamp of the last status transition. A reef field with no
   * akb-native home and no filter/sort need — set by the board on drag and
   * read by the project-state prompt, so it should survive the round-trip.
   */
  last_status_change: string | null;
  external_refs: IssueMetadata["external_refs"] | null;
  implementation_refs: IssueMetadata["implementation_refs"] | null;
  watchers: IssueMetadata["watchers"] | null;
  reviewers: IssueMetadata["reviewers"] | null;
  qa_owner: IssueMetadata["qa_owner"] | null;
  custom_fields: IssueMetadata["custom_fields"] | null;
}

function buildIssueRowMeta(issue: IssueMetadata): IssueRowMeta {
  return {
    author: issue.created_by,
    last_editor: issue.updated_by,
    source: issue.source ?? null,
    last_status_change: issue.last_status_change ?? null,
    external_refs: issue.external_refs ?? null,
    implementation_refs: issue.implementation_refs ?? null,
    watchers: issue.watchers ?? null,
    reviewers: issue.reviewers ?? null,
    qa_owner: issue.qa_owner ?? null,
    custom_fields: issue.custom_fields ?? null,
  };
}

/**
 * json/jsonb columns round-trip through akb's SQL endpoint as JSON text (see
 * `decodeSettingsValue`). Decode to a string[] and treat empty/absent as
 * `undefined` so reconstructed Issues match the "optional field omitted"
 * shape rather than carrying `[]`.
 */
export function decodeStringArray(raw: unknown): string[] | undefined {
  const decoded = decodeSettingsValue(raw);
  if (Array.isArray(decoded) && decoded.length > 0) {
    return decoded.map((v) => String(v));
  }
  return undefined;
}

function nonEmptyText(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function issueTypeOrDefault(
  issue: IssueMetadata,
): NonNullable<IssueMetadata["issue_type"]> {
  return issue.issue_type ?? "task";
}

export function quoteOptionalText(
  value: string | null | undefined,
  fieldDescriptor: string,
): string {
  return quoteTextOrNull(nonEmptyText(value), fieldDescriptor);
}

/**
 * Validate a `meta`-sourced array of refined ref objects (`implementation_refs`
 * / `external_refs`), keeping the entries that parse and dropping the ones that
 * do not. These two fields live in the ad-hoc `meta` JSON, which an external
 * writer (a code-activity scan, a sibling dev automation) can fill with a shape
 * the ref schema rejects — a `branch` entry keyed by `name` with no required
 * `ref`, or an unknown `type` like `evidence`. Validating the whole issue
 * against `IssueMetadataSchema` would then throw, and every `rowToIssue` caller
 * (`listIssues`, `readIssue`, relations, search) would drop the ENTIRE issue
 * from the board, list, search, and the parent's children — invisibly, on an
 * internal trace. That blast radius is far too large for one malformed optional
 * ref, so degrade gracefully: keep the valid entries, drop the bad ones, and
 * report the count. A non-array (a bare string/object where an array belongs)
 * counts as one drop so the caller can still flag it.
 */
function sanitizeMetaRefs<S extends z.ZodTypeAny>(
  raw: unknown,
  schema: S,
): { refs: z.infer<S>[] | undefined; dropped: number } {
  if (raw == null) return { refs: undefined, dropped: 0 };
  if (!Array.isArray(raw)) return { refs: undefined, dropped: 1 };
  const refs: z.infer<S>[] = [];
  let dropped = 0;
  for (const entry of raw) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) {
      refs.push(parsed.data);
    } else {
      dropped += 1;
    }
  }
  return { refs: refs.length > 0 ? refs : undefined, dropped };
}

/**
 * Map a `reef_issues` row back into reef issue metadata. Timestamps come from akb's
 * auto-managed row columns (`created_at`/`updated_at`); the semantic actors
 * come from `meta`. Validated through `IssueMetadataSchema` so a malformed row
 * fails loudly at the boundary — except the ad-hoc `meta` ref arrays, which are
 * sanitized per-entry first (see `sanitizeMetaRefs`) so one bad delivery/external
 * ref degrades to a dropped ref instead of an invisible issue.
 */
export function rowToIssue(row: Record<string, unknown>): IssueMetadata {
  const meta = (decodeSettingsValue(row.meta) ?? {}) as Partial<IssueRowMeta>;
  const implementationRefs = sanitizeMetaRefs(
    meta.implementation_refs,
    ImplementationRefSchema,
  );
  const externalRefs = sanitizeMetaRefs(meta.external_refs, ExternalRefSchema);
  if (implementationRefs.dropped > 0 || externalRefs.dropped > 0) {
    observe(
      undefined,
      {
        reef_id: typeof row.reef_id === "string" ? row.reef_id : undefined,
        dropped_implementation_refs: implementationRefs.dropped || undefined,
        dropped_external_refs: externalRefs.dropped || undefined,
      },
      "akb.row_to_issue.dropped_invalid_meta_refs",
      { level: "warn" },
    );
  }
  const candidate: Record<string, unknown> = {
    id: row.reef_id,
    title: row.title,
    status: row.status,
    issue_type: row.issue_type ?? "task",
    created_at: row.created_at,
    created_by: meta.author,
    updated_at: row.updated_at,
    updated_by: meta.last_editor,
    labels: decodeStringArray(row.labels),
    depends_on: decodeStringArray(row.depends_on),
    related_to: decodeStringArray(row.related_to),
    blocks: decodeStringArray(row.blocks),
    ...(row.priority != null && { priority: row.priority }),
    ...(row.assigned_to != null && { assigned_to: row.assigned_to }),
    ...(row.requester != null && { requester: row.requester }),
    ...(row.reporter != null && { reporter: row.reporter }),
    ...(row.start_date != null && { start_date: row.start_date }),
    ...(row.due_date != null && { due_date: row.due_date }),
    ...(row.milestone_id != null && { milestone_id: row.milestone_id }),
    ...(row.sprint_id != null && { sprint_id: row.sprint_id }),
    ...(row.release_id != null && { release_id: row.release_id }),
    ...(row.estimate_points != null && {
      estimate_points: Number(row.estimate_points),
    }),
    ...(row.severity != null && { severity: row.severity }),
    ...(row.rank != null && { rank: Number(row.rank) }),
    ...(row.closed_at != null && { closed_at: row.closed_at }),
    ...(row.closed_reason != null && { closed_reason: row.closed_reason }),
    ...(row.parent_id != null && { parent_id: row.parent_id }),
    ...(row.archived_at != null && { archived_at: row.archived_at }),
    ...(meta.source != null && { source: meta.source }),
    ...(meta.last_status_change != null && {
      last_status_change: meta.last_status_change,
    }),
    ...(externalRefs.refs != null && { external_refs: externalRefs.refs }),
    ...(implementationRefs.refs != null && {
      implementation_refs: implementationRefs.refs,
    }),
    ...(meta.watchers != null && { watchers: meta.watchers }),
    ...(meta.reviewers != null && { reviewers: meta.reviewers }),
    ...(meta.qa_owner != null && { qa_owner: meta.qa_owner }),
    ...(meta.custom_fields != null && { custom_fields: meta.custom_fields }),
  };
  try {
    return IssueMetadataSchema.parse(candidate);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new SchemaValidationError({
        issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    throw new SchemaValidationError({
      issues: ["Issue row validation failed"],
    });
  }
}

/**
 * SQL scalar subquery yielding the next tail rank for the active backlog:
 * `RANK_STEP` above the current maximum, so a new or demoted backlog issue
 * appends to the BOTTOM of the product-managed backlog order (REEF-176). An
 * empty backlog yields `RANK_STEP`. Computed in-statement (not read-then-write)
 * so a create/demote stays one atomic write; concurrent appends can tie on the
 * same max and are broken by `reef_id`, then re-spaced by the next drag.
 *
 * Assumes the born-correct invariant (a fully-ranked active backlog). A older
 * `rank IS NULL` row predating this invariant displays at the COALESCE sort
 * sentinel — the very tail — so a new issue's real `MAX+STEP` rank would sort
 * ABOVE it rather than at the visible bottom. Such rows are eliminated by the
 * one-time backfill (REEF-176 AC4), not papered over here: there is no finite
 * rank below the sentinel, and a born-correct vault does not accumulates nulls, so
 * every later create/demote keeps the backlog total. The sentinel keeps any
 * stray null sorting safely in the meantime (no corruption), just at the tail.
 */
export function backlogTailRankExpr(): string {
  return `(SELECT COALESCE(MAX("rank"), 0) + ${RANK_STEP} FROM ${tableRef(
    REEF_ISSUES_TABLE,
  )} WHERE "status" = 'backlog' AND "archived_at" IS NULL)`;
}

/**
 * The mutable issue-row columns and their SQL value literals, derived from the
 * Issue. Shared by INSERT and UPDATE — `document_uri` and `reef_id` are the
 * immutable keys and are added separately on INSERT just. `opts.rankExpr`
 * substitutes a raw SQL expression for the `rank` value (the born-correct tail
 * subquery on a backlog entry) instead of the literal `issue.rank`. Trusted
 * importers may set `issue.rank` before INSERT to seed issue-wide ordering
 * (REEF-393); generic product create/update schemas still keep rank out of
 * user-authored patches.
 */
export function issueRowMutableFields(
  issue: IssueMetadata,
  opts?: { rankExpr?: string },
): Array<[string, string]> {
  return [
    ["title", quoteText(issue.title, "issue title")],
    ["status", quoteText(issue.status, "issue status")],
    ["issue_type", quoteText(issueTypeOrDefault(issue), "issue issue_type")],
    ["priority", quoteTextOrNull(issue.priority, "issue priority")],
    ["assigned_to", quoteOptionalText(issue.assigned_to, "issue assigned_to")],
    ["requester", quoteOptionalText(issue.requester, "issue requester")],
    ["reporter", quoteOptionalText(issue.reporter, "issue reporter")],
    ["start_date", quoteTextOrNull(issue.start_date, "issue start_date")],
    ["due_date", quoteTextOrNull(issue.due_date, "issue due_date")],
    [
      "milestone_id",
      quoteOptionalText(issue.milestone_id, "issue milestone_id"),
    ],
    ["sprint_id", quoteOptionalText(issue.sprint_id, "issue sprint_id")],
    ["release_id", quoteOptionalText(issue.release_id, "issue release_id")],
    ["estimate_points", quoteNumberOrNull(issue.estimate_points)],
    ["severity", quoteTextOrNull(issue.severity, "issue severity")],
    ["rank", opts?.rankExpr ?? quoteNumberOrNull(issue.rank)],
    ["closed_at", quoteTextOrNull(issue.closed_at, "issue closed_at")],
    [
      "closed_reason",
      quoteTextOrNull(issue.closed_reason, "issue closed_reason"),
    ],
    ["parent_id", quoteOptionalText(issue.parent_id, "issue parent_id")],
    ["labels", quoteJson(issue.labels ?? [])],
    ["depends_on", quoteJson(issue.depends_on ?? [])],
    ["related_to", quoteJson(issue.related_to ?? [])],
    ["blocks", quoteJson(issue.blocks ?? [])],
    ["archived_at", quoteTextOrNull(issue.archived_at, "issue archived_at")],
    ["meta", quoteJson(buildIssueRowMeta(issue))],
  ];
}

/** INSERT the projection row for an issue. Used on create and on delete's
 * compensating restore. `document_uri` / `reef_id` are the immutable keys.
 * `opts.assignBacklogRank` (set by `writeIssue` on a genuine product create)
 * appends a new backlog issue to the manual-order tail (REEF-176); the
 * delete-restore path omits it so the row is recreated with its exact prior
 * rank. */
export function insertIssueRow(
  adapter: AkbAdapter,
  vault: string,
  issue: IssueMetadata,
  documentUri: string,
  opts?: { assignBacklogRank?: boolean },
): Promise<AkbSqlResponse> {
  // Born-correct: an issue entering the backlog with no explicit rank gets the
  // tail subquery, so the backlog is does not partially unranked and a filtered
  // drag-reorder stays safe (REEF-176). Non-backlog creates keep rank NULL.
  const assignTail =
    opts?.assignBacklogRank === true &&
    issue.status === "backlog" &&
    issue.rank == null;
  const fields = issueRowMutableFields(
    issue,
    assignTail ? { rankExpr: backlogTailRankExpr() } : undefined,
  );
  const columns = ["document_uri", "reef_id", ...fields.map(([c]) => c)]
    .map(quoteIdent)
    .join(", ");
  const values = [
    quoteText(documentUri, "document_uri"),
    quoteText(issue.id, "reef_id"),
    ...fields.map(([, v]) => v),
  ].join(", ");
  return runSql(
    adapter,
    vault,
    `INSERT INTO ${tableRef(REEF_ISSUES_TABLE)} (${columns}) VALUES (${values})`,
  );
}

/** `col = value, col = value` SET clause from `[column, sqlLiteral]` pairs. */
export function buildRowAssignments(fields: Array<[string, string]>): string {
  return fields.map(([c, v]) => `${quoteIdent(c)} = ${v}`).join(", ");
}

export function stringArraysEqual(
  a: string[] | undefined,
  b: string[] | undefined,
): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

/**
 * Per-status row counts under an optional `WHERE`, for board column headers.
 * Tolerates a does not-onboarded vault (missing table → `{}`). Any status absent
 * from the result is implicitly zero for the caller.
 */
export async function countIssuesByColumn(
  adapter: AkbAdapter,
  vault: string,
  where?: string,
): Promise<Record<string, number>> {
  const sql = `SELECT "status", COUNT(*) AS count FROM ${tableRef(
    REEF_ISSUES_TABLE,
  )}${where ? ` WHERE ${where}` : ""} GROUP BY "status"`;
  let res: AkbSqlResponse;
  try {
    res = await runSql(adapter, vault, sql);
  } catch (err) {
    if (isMissingTableError(err)) return {};
    throw err;
  }
  const counts: Record<string, number> = {};
  if (res.kind === "table_query") {
    for (const row of res.items) {
      const status = row.status;
      const n = typeof row.count === "number" ? row.count : Number(row.count);
      if (typeof status === "string" && Number.isFinite(n)) {
        counts[status] = n;
      }
    }
  }
  return counts;
}

/**
 * Run a `SELECT * FROM reef_issues [WHERE ...] [ORDER BY ...] [LIMIT n]` and
 * return the raw rows. `orderBy` / `limit` are optional so existing `WHERE`
 * callers (`readIssue`, `deleteIssue`, planning reference checks) are unchanged.
 */
export async function selectIssueRows(
  adapter: AkbAdapter,
  vault: string,
  where?: string,
  orderBy?: string,
  limit?: number,
): Promise<Record<string, unknown>[]> {
  const sql = `SELECT * FROM ${tableRef(REEF_ISSUES_TABLE)}${
    where ? ` WHERE ${where}` : ""
  }${orderBy ? ` ORDER BY ${orderBy}` : ""}${
    limit != null ? ` LIMIT ${quoteIntOrNull(limit)}` : ""
  }`;
  const res = await runSql(adapter, vault, sql);
  return res.kind === "table_query" ? res.items : [];
}
