import { SchemaValidationError } from "../../../errors";
import { RANK_NULL_SORT_SENTINEL } from "../../../models/backlogRank";
import { ACTIVE_STATUSES } from "../../../models/status";
import type { IssueListQuery } from "../../../schemas/issues/requests";
import { quoteIdent, quoteNumberOrNull, quoteText } from "../core/sql";

// ─── Issue list query builders (filter / sort / counts) ─────────────────────

/**
 * SQL `CASE` mapping the `priority` column to a sortable rank that mirrors the
 * client `PRIORITY_RANK` (critical highest, null/unknown lowest). Fully static
 * — no interpolation — so it is safe to inline in `ORDER BY`.
 */
export function priorityRankCase(): string {
  return `CASE "priority" WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END`;
}

/**
 * A case-insensitive substring (`ILIKE '%value%'`) predicate. The value's LIKE
 * metacharacters (`%`, `_`, `\`) are escaped and an explicit `ESCAPE '\'` is
 * emitted, then the whole pattern is quoted via `quoteText`. Mirrors the client
 * `searchIssues` substring semantics for the free-text `q` facet. (The
 * assignee/requester *facets* now match exactly — see `lowerInClause` — so this
 * substring form is reserved for the `q` search path, REEF-267.)
 */
function likeContainsClause(
  column: string,
  value: string,
  fieldDescriptor: string,
): string {
  const escaped = value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `${quoteIdent(column)} ILIKE ${quoteText(
    `%${escaped}%`,
    fieldDescriptor,
  )} ESCAPE '\\'`;
}

/**
 * A case-insensitive substring predicate against the JSON `labels` column,
 * cast to `text` so the serialized array (`["bug","ui"]`) is matched as a
 * string. The value's LIKE metacharacters are escaped and quoted exactly like
 * `likeContainsClause`; `labels` is a fixed column name so the cast is inlined.
 * Used by the `q` free-text predicate to surface a label hit.
 */
function labelsContainsClause(value: string, fieldDescriptor: string): string {
  const escaped = value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `"labels"::text ILIKE ${quoteText(
    `%${escaped}%`,
    fieldDescriptor,
  )} ESCAPE '\\'`;
}

/**
 * A case-insensitive exact-match `IN` predicate: `LOWER("col") IN ('a', 'b')`,
 * each value lowercased and quoted. Used for the assignee / requester facets
 * (REEF-267) — exact equality, OR-combined within the facet — so a one-person
 * filter does not incidentally match a different login the way the old substring
 * `ILIKE` did (which forced My Work's client re-scope, REEF-181). Case-folding
 * mirrors the client `matchesSharedFacets` / `filterAssignedTo`, which compare
 * `assigned_to` lowercased on both sides, so the server pre-filter and the
 * client safety net agree.
 */
function lowerInClause(
  column: string,
  values: readonly string[],
  descriptor: string,
): string {
  const list = values
    .map((v) => quoteText(v.toLowerCase(), descriptor))
    .join(", ");
  return `LOWER(${quoteIdent(column)}) IN (${list})`;
}

/**
 * Build the SQL `WHERE` body (without the `WHERE` keyword) for the issue-list
 * filter facets, or `undefined` when nothing narrows the set. Every value is
 * escaped via `quoteText` / `quoteIdent`; columns are quoted, the table is a
 * bare `tableRef`. No raw interpolation.
 *
 * The multi-select facets OR-combine their values via `IN`: `status` / `priority`
 * / `severity` / `sprint_id` / `release_id` by exact value, `assigned_to` /
 * `requester` by case-insensitive exact match (`lowerInClause`, REEF-267 — the
 * same exact predicate the My-Issues default view already uses). `milestone_id`
 * stays a single exact `=` (multi-select out of scope, REEF-267). `issue_type =
 * 'task'` also matches NULL rows, mirroring the client `(issue_type ?? "task")`
 * default. `archived: false` (the default) adds the `archived_at IS NULL` floor;
 * `archived: true` widens and omits it.
 *
 * The free-text `q` facet is a single OR group spanning nine fields — the eight
 * TEXT columns `reef_id` / `title` / `assigned_to` / `requester` / `reporter` /
 * `milestone_id` / `sprint_id` / `release_id` (substring `ILIKE`) plus the JSON
 * `labels` column matched via a `::text` cast — AND-combined with the other
 * facets so search narrows within the active filter rather than replacing it.
 */
export function buildIssueWhere(filter: IssueListQuery): string | undefined {
  const clauses: string[] = [];

  const inClause = (
    column: string,
    values: readonly string[],
    descriptor: string,
  ): string => {
    const list = values.map((v) => quoteText(v, descriptor)).join(", ");
    return `${quoteIdent(column)} IN (${list})`;
  };

  if (filter.status?.length) {
    clauses.push(inClause("status", filter.status, "status filter"));
  }
  if (filter.priority?.length) {
    clauses.push(inClause("priority", filter.priority, "priority filter"));
  }
  if (filter.severity?.length) {
    clauses.push(inClause("severity", filter.severity, "severity filter"));
  }
  if (filter.issue_type?.length) {
    const parts = filter.issue_type.map((t) =>
      t === "task"
        ? `("issue_type" = ${quoteText(t, "issue_type filter")} OR "issue_type" IS NULL)`
        : `"issue_type" = ${quoteText(t, "issue_type filter")}`,
    );
    clauses.push(parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`);
  }
  if (filter.assigned_to?.length) {
    clauses.push(
      lowerInClause("assigned_to", filter.assigned_to, "assigned_to filter"),
    );
  }
  if (filter.requester?.length) {
    clauses.push(
      lowerInClause("requester", filter.requester, "requester filter"),
    );
  }
  if (filter.sprint_id?.length) {
    clauses.push(inClause("sprint_id", filter.sprint_id, "sprint_id filter"));
  }
  if (filter.milestone_id) {
    clauses.push(
      `"milestone_id" = ${quoteText(filter.milestone_id, "milestone_id filter")}`,
    );
  }
  if (filter.release_id?.length) {
    clauses.push(
      inClause("release_id", filter.release_id, "release_id filter"),
    );
  }
  if (filter.due_after) {
    clauses.push(
      `"due_date" >= ${quoteText(filter.due_after, "due_after filter")}`,
    );
  }
  if (filter.due_before) {
    clauses.push(
      `"due_date" <= ${quoteText(filter.due_before, "due_before filter")}`,
    );
  }
  if (filter.q) {
    const group = [
      likeContainsClause("reef_id", filter.q, "q filter"),
      likeContainsClause("title", filter.q, "q filter"),
      likeContainsClause("assigned_to", filter.q, "q filter"),
      likeContainsClause("requester", filter.q, "q filter"),
      likeContainsClause("reporter", filter.q, "q filter"),
      likeContainsClause("milestone_id", filter.q, "q filter"),
      likeContainsClause("sprint_id", filter.q, "q filter"),
      likeContainsClause("release_id", filter.q, "q filter"),
      labelsContainsClause(filter.q, "q filter"),
    ].join(" OR ");
    clauses.push(`(${group})`);
  }
  if (filter.archived === false) {
    clauses.push(`"archived_at" IS NULL`);
  }

  return clauses.length > 0 ? clauses.join(" AND ") : undefined;
}

const PRIORITY_SQL_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * The sort field / order with their optional-ness stripped — the builders and
 * cursor codec consistently operate on a concrete (resolved) sort.
 */
type IssueSortField = NonNullable<IssueListQuery["sort_field"]>;
type IssueSortOrder = NonNullable<IssueListQuery["sort_order"]>;

const NUMERIC_SORT_FIELDS = new Set<IssueSortField>([
  "priority",
  "rank",
  "estimate_points",
]);

/**
 * The lead `ORDER BY` / keyset expression for a sort field. `priority` sorts by
 * the rank `CASE`; the nullable `rank` / `estimate_points` / date columns are
 * wrapped in `COALESCE` so NULLs sort deterministically and the keyset
 * comparison does not hits a NULL; `created_at` / `updated_at` / `title` are NOT
 * NULL. ORDER BY and the keyset share this expression so paging stays exact.
 *
 * `rank` (the backlog manual order, REEF-129) coalesces NULL to
 * `RANK_NULL_SORT_SENTINEL` — a value far above any real rank — so unranked
 * issues sink below the manually-ordered ones under ascending order, instead of
 * collapsing to 0 and floating to the top.
 */
function sortLeadExpr(sortField: IssueSortField): string {
  switch (sortField) {
    case "priority":
      return priorityRankCase();
    case "rank":
      return `COALESCE("rank", ${RANK_NULL_SORT_SENTINEL})`;
    case "estimate_points":
      return `COALESCE("estimate_points", 0)`;
    case "due_date":
    case "start_date":
      return `COALESCE(${quoteIdent(sortField)}, '')`;
    default:
      return quoteIdent(sortField);
  }
}

/**
 * Build the `ORDER BY` body (without the keyword) for the issue list. A unique
 * `reef_id DESC` tiebreaker is consistently appended so paging stays deterministic
 * under akb's last-write-wins. Direction is a literal `ASC`/`DESC` — does not
 * interpolated from input.
 */
export function buildIssueOrderBy(
  sortField: IssueSortField,
  sortOrder: IssueSortOrder,
): string {
  const dir = sortOrder === "asc" ? "ASC" : "DESC";
  return `${sortLeadExpr(sortField)} ${dir}, "reef_id" DESC`;
}

/**
 * Opaque keyset cursor parts: the lead sort-key value (`k`) and the unique
 * `reef_id` tiebreaker (`id`), both serialized as strings.
 */
export interface IssueCursorParts {
  k: string;
  id: string;
}

/**
 * The lead sort-key value for a RAW SQL row, matching `sortLeadExpr`. Read from
 * the raw row (not the parsed issue) so a skipped malformed row does not advances
 * the cursor past an unparsed-but-valid neighbor.
 */
function cursorLeadValue(
  row: Record<string, unknown>,
  sortField: IssueSortField,
): string {
  if (sortField === "priority") {
    const priority = typeof row.priority === "string" ? row.priority : "";
    return String(PRIORITY_SQL_RANK[priority] ?? 0);
  }
  if (sortField === "rank") {
    // Match `sortLeadExpr`: a NULL/absent rank coalesces to the sentinel so the
    // cursor lands an unranked row in the tail, not at 0. A real numeric value
    // (akb may return it as a string) is parsed the same way `rowToIssue` does.
    const raw = row.rank;
    if (raw == null) return String(RANK_NULL_SORT_SENTINEL);
    const num = typeof raw === "number" ? raw : Number(raw);
    return String(Number.isFinite(num) ? num : RANK_NULL_SORT_SENTINEL);
  }
  if (sortField === "estimate_points") {
    // akb may return a numeric SQL column as a string; parse it the same way
    // rowToIssue does so a value like '5' is not collapsed to 0 in the cursor.
    const raw = row.estimate_points;
    const num = typeof raw === "number" ? raw : Number(raw);
    return String(Number.isFinite(num) ? num : 0);
  }
  const value = row[sortField];
  return typeof value === "string" ? value : "";
}

/** Encode the keyset cursor for the last row of a page. */
export function encodeCursor(
  row: Record<string, unknown>,
  sortField: IssueSortField,
): string {
  const parts: IssueCursorParts = {
    k: cursorLeadValue(row, sortField),
    id: String(row.reef_id ?? ""),
  };
  return Buffer.from(JSON.stringify(parts), "utf-8").toString("base64url");
}

/** Decode an opaque keyset cursor, throwing on a malformed value. */
export function decodeCursor(cursor: string): IssueCursorParts {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf-8"),
    );
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as IssueCursorParts).k === "string" &&
      typeof (parsed as IssueCursorParts).id === "string"
    ) {
      return parsed as IssueCursorParts;
    }
  } catch {
    // fall through to the thrown error below
  }
  throw new SchemaValidationError({ issues: ["invalid issue list cursor"] });
}

/**
 * Build the keyset `WHERE` predicate selecting "rows after the cursor" in the
 * given sort direction, with `reef_id DESC` as the unique tiebreaker. The lead
 * expression matches `sortLeadExpr`; every cursor value is escaped.
 */
export function buildKeysetWhere(
  sortField: IssueSortField,
  sortOrder: IssueSortOrder,
  cursor: IssueCursorParts,
): string {
  const lead = sortLeadExpr(sortField);
  const cmp = sortOrder === "asc" ? ">" : "<";
  const kLit = NUMERIC_SORT_FIELDS.has(sortField)
    ? quoteNumberOrNull(Number(cursor.k))
    : quoteText(cursor.k, "cursor key");
  const idLit = quoteText(cursor.id, "cursor reef_id");
  return `((${lead} ${cmp} ${kLit}) OR (${lead} = ${kLit} AND "reef_id" < ${idLit}))`;
}

/**
 * The status window the default view consistently floors to: active issues (not
 * backlog, not done/closed) that are not archived. The `IN (...)` list is
 * derived from the shared `ACTIVE_STATUSES` lifecycle constant (REEF-109) so
 * the SQL floor, the board/timeline columns, and the report metrics all exclude
 * the same set. Each member is a fixed enum constant quoted via `quoteText`.
 */
export function defaultViewStatusFloor(): string {
  const statuses = ACTIVE_STATUSES.map((s) =>
    quoteText(s, "active status floor"),
  ).join(", ");
  return `"archived_at" IS NULL AND "status" IN (${statuses})`;
}

/**
 * The default-view WHERE ladder for the issue list's first landing: the
 * status-window floor, narrowed to the actor's issues (My Issues) when an actor
 * is known, else to the active sprint when one exists, else the floor alone.
 * Pure — the caller resolves the actor (from the session) and the active-sprint
 * id (from planning) first. Values are escaped via `quoteText`.
 */
export function buildDefaultViewWhere(params: {
  actor: string | null;
  sprintId: string | null;
}): string {
  const floor = defaultViewStatusFloor();
  if (params.actor) {
    return `${floor} AND "assigned_to" = ${quoteText(
      params.actor,
      "default view actor",
    )}`;
  }
  if (params.sprintId) {
    return `${floor} AND "sprint_id" = ${quoteText(
      params.sprintId,
      "default view sprint",
    )}`;
  }
  return floor;
}
