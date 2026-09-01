import { SchemaValidationError } from "../../../errors";
import { RANK_NULL_SORT_SENTINEL } from "../../../models/backlogRank";
import { parseIssueId } from "../../../models/id";
import { ACTIVE_STATUSES } from "../../../models/status";
import type { IssueListQuery } from "../../../schemas/issues/requests";
import { REEF_ISSUES_TABLE, REEF_SPRINTS_TABLE } from "../core/constants";
import { type SqlParameterBuilder, quoteIdent, tableRef } from "../core/sql";

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
 * emitted, then the whole pattern is added as a SQL parameter. Mirrors the client
 * `searchIssues` substring semantics for the free-text `q` facet. (The
 * assignee/requester *facets* now match exactly — see `lowerInClause` — so this
 * substring form is reserved for the `q` search path, REEF-267.)
 */
function likePattern(value: string): string {
  const escaped = value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

function likeContainsClause(column: string, patternParam: string): string {
  return `${quoteIdent(column)} ILIKE ${patternParam} ESCAPE '\\'`;
}

/**
 * A case-insensitive substring predicate against the JSON `labels` column,
 * cast to `text` so the serialized array (`["bug","ui"]`) is matched as a
 * string. The value's LIKE metacharacters are escaped and parameterized exactly
 * like `likeContainsClause`; `labels` is a fixed column name so the cast is inlined.
 * Used by the `q` free-text predicate to surface a label hit.
 */
function labelsContainsClause(patternParam: string): string {
  return `"labels"::text ILIKE ${patternParam} ESCAPE '\\'`;
}

/**
 * A case-insensitive exact-match `IN` predicate: `LOWER("col") IN ($1, $2)`,
 * each value lowercased and parameterized. Used for the assignee / requester facets
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
  params: SqlParameterBuilder,
): string {
  const list = values
    .map((v) => params.add(v.toLowerCase(), descriptor))
    .join(", ");
  return `LOWER(${quoteIdent(column)}) IN (${list})`;
}

function orGroup(parts: readonly string[]): string {
  return parts.length === 1 ? (parts[0] ?? "") : `(${parts.join(" OR ")})`;
}

/**
 * Build the SQL `WHERE` body (without the `WHERE` keyword) for the issue-list
 * filter facets, or `undefined` when nothing narrows the set. Every value is
 * added to the supplied parameter builder; columns are quoted and no user
 * value is interpolated into the SQL fragment.
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
export function buildIssueWhere(
  filter: IssueListQuery,
  params: SqlParameterBuilder,
): string | undefined {
  const clauses: string[] = [];

  const inClause = (
    column: string,
    values: readonly string[],
    descriptor: string,
  ): string => {
    const list = values.map((v) => params.add(v, descriptor)).join(", ");
    return `${quoteIdent(column)} IN (${list})`;
  };

  if (filter.status?.length) {
    clauses.push(inClause("status", filter.status, "status filter"));
  }
  if (filter.priority?.length || filter.priority_unset) {
    const parts: string[] = [];
    if (filter.priority?.length) {
      parts.push(inClause("priority", filter.priority, "priority filter"));
    }
    if (filter.priority_unset) parts.push(`"priority" IS NULL`);
    clauses.push(orGroup(parts));
  }
  if (filter.severity?.length || filter.severity_unset) {
    const parts: string[] = [];
    if (filter.severity?.length) {
      parts.push(inClause("severity", filter.severity, "severity filter"));
    }
    if (filter.severity_unset) parts.push(`"severity" IS NULL`);
    clauses.push(orGroup(parts));
  }
  if (filter.issue_type?.length) {
    const parts = filter.issue_type.map((t) =>
      t === "task"
        ? `("issue_type" = ${params.add(t, "issue_type filter")} OR "issue_type" IS NULL)`
        : `"issue_type" = ${params.add(t, "issue_type filter")}`,
    );
    clauses.push(parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`);
  }
  if (filter.assigned_to?.length || filter.assigned_to_unset) {
    const parts: string[] = [];
    if (filter.assigned_to?.length) {
      parts.push(
        lowerInClause(
          "assigned_to",
          filter.assigned_to,
          "assigned_to filter",
          params,
        ),
      );
    }
    if (filter.assigned_to_unset) {
      parts.push(`COALESCE(BTRIM("assigned_to"), '') = ''`);
    }
    clauses.push(orGroup(parts));
  }
  if (filter.requester?.length) {
    clauses.push(
      lowerInClause("requester", filter.requester, "requester filter", params),
    );
  }
  if (filter.sprint_id?.length) {
    clauses.push(inClause("sprint_id", filter.sprint_id, "sprint_id filter"));
  }
  if (filter.milestone_id) {
    clauses.push(
      `"milestone_id" = ${params.add(
        filter.milestone_id,
        "milestone_id filter",
      )}`,
    );
  }
  if (filter.release_id?.length) {
    clauses.push(
      inClause("release_id", filter.release_id, "release_id filter"),
    );
  }
  if (filter.due_after) {
    clauses.push(
      `"due_date" >= ${params.add(filter.due_after, "due_after filter")}`,
    );
  }
  if (filter.due_before) {
    clauses.push(
      `"due_date" <= ${params.add(filter.due_before, "due_before filter")}`,
    );
  }
  if (filter.due_unset) clauses.push(`"due_date" IS NULL`);
  if (filter.q) {
    const patternParam = params.add(likePattern(filter.q), "q filter");
    const group = [
      likeContainsClause("reef_id", patternParam),
      likeContainsClause("title", patternParam),
      likeContainsClause("assigned_to", patternParam),
      likeContainsClause("requester", patternParam),
      likeContainsClause("reporter", patternParam),
      likeContainsClause("milestone_id", patternParam),
      likeContainsClause("sprint_id", patternParam),
      likeContainsClause("release_id", patternParam),
      labelsContainsClause(patternParam),
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
  "reef_id",
]);

/** SQL equivalent of the canonical `parseIssueId(...).number` contract. */
const ISSUE_NUMBER_SORT_EXPR = `CAST(SUBSTRING("reef_id" FROM '[0-9]+$') AS NUMERIC)`;

function isDateSortField(
  sortField: IssueSortField,
): sortField is "due_date" | "start_date" {
  return sortField === "due_date" || sortField === "start_date";
}

/** Keep missing dates in one direction-independent tail bucket. */
function dateNullBucketExpr(sortField: "due_date" | "start_date"): string {
  return `CASE WHEN ${quoteIdent(sortField)} IS NULL THEN 1 ELSE 0 END`;
}

const ISSUE_TITLE_COLLATION = "und-x-icu";

/**
 * The lead `ORDER BY` / keyset expression for a sort field. `priority` sorts by
 * the rank `CASE`; the nullable `rank` / `estimate_points` / date columns are
 * wrapped in `COALESCE` so the value comparison never hits a NULL. Date
 * ORDER BY/keyset callers add a separate direction-independent NULL bucket
 * before this expression so missing dates always stay at the tail.
 * `created_at` / `updated_at` / `title` are NOT NULL. ORDER BY and the keyset
 * share these expressions so paging stays exact.
 *
 * `rank` (the issue-wide ordering scalar, REEF-129/393) coalesces NULL to
 * `RANK_NULL_SORT_SENTINEL` — a value far above any real rank — so unranked or
 * unmapped issues sink below ordered ones under ascending order, instead of
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
    case "reef_id":
      return ISSUE_NUMBER_SORT_EXPR;
    case "due_date":
    case "start_date":
      return `COALESCE(${quoteIdent(sortField)}, '')`;
    case "title":
      return `${quoteIdent(sortField)} COLLATE "${ISSUE_TITLE_COLLATION}"`;
    default:
      return quoteIdent(sortField);
  }
}

/**
 * Build the `ORDER BY` body (without the keyword) for the issue list. The
 * canonical numeric issue number is consistently appended as a DESC tiebreaker
 * so paging stays deterministic under akb's last-write-wins. A ticket-number
 * sort already uses that expression as its lead, so it does not duplicate it.
 * Direction is a literal `ASC`/`DESC` — does not interpolated from input.
 */
export function buildIssueOrderBy(
  sortField: IssueSortField,
  sortOrder: IssueSortOrder,
): string {
  const dir = sortOrder === "asc" ? "ASC" : "DESC";
  if (sortField === "reef_id") {
    return `${sortLeadExpr(sortField)} ${dir}`;
  }
  if (isDateSortField(sortField)) {
    return `${dateNullBucketExpr(sortField)} ASC, ${sortLeadExpr(
      sortField,
    )} ${dir}, ${ISSUE_NUMBER_SORT_EXPR} DESC`;
  }
  return `${sortLeadExpr(sortField)} ${dir}, ${ISSUE_NUMBER_SORT_EXPR} DESC`;
}

/**
 * Opaque keyset cursor parts: the lead sort-key value (`k`) and the canonical
 * issue id (`id`) whose numeric suffix supplies the DESC tiebreaker, both
 * serialized as strings.
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
  if (sortField === "reef_id") {
    return String(parseIssueId(String(row.reef_id ?? "")).number);
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
 * given sort direction, with the canonical numeric issue number DESC as the
 * tiebreaker. The lead expression matches `sortLeadExpr`; every cursor value
 * is validated and added to the supplied parameter builder.
 */
export function buildKeysetWhere(
  sortField: IssueSortField,
  sortOrder: IssueSortOrder,
  cursor: IssueCursorParts,
  params: SqlParameterBuilder,
): string {
  const lead = sortLeadExpr(sortField);
  const cmp = sortOrder === "asc" ? ">" : "<";
  if (sortField === "reef_id") {
    const kParam = NUMERIC_SORT_FIELDS.has(sortField)
      ? params.add(Number(cursor.k), "cursor key")
      : params.add(cursor.k, "cursor key");
    return `(${lead} ${cmp} ${kParam})`;
  }
  if (isDateSortField(sortField)) {
    // Date cursors use the empty lead value as the NULL marker (ISO date
    // fields cannot contain an empty string). The bucket is always ASC so the
    // real dates precede the NULL tail for both date directions.
    const nullBucket = dateNullBucketExpr(sortField);
    const cursorNullBucket = params.add(
      cursor.k === "" ? 1 : 0,
      "cursor null bucket",
    );
    const kParam = params.add(cursor.k, "cursor key");
    const issueNumberParam = params.add(
      parseIssueId(cursor.id).number,
      "cursor issue number",
    );
    return `((${nullBucket} > ${cursorNullBucket}) OR (${nullBucket} = ${cursorNullBucket} AND ((${lead} ${cmp} ${kParam}) OR (${lead} = ${kParam} AND ${ISSUE_NUMBER_SORT_EXPR} < ${issueNumberParam}))))`;
  }
  const kParam = NUMERIC_SORT_FIELDS.has(sortField)
    ? params.add(Number(cursor.k), "cursor key")
    : params.add(cursor.k, "cursor key");
  const issueNumberParam = params.add(
    parseIssueId(cursor.id).number,
    "cursor issue number",
  );
  return `((${lead} ${cmp} ${kParam}) OR (${lead} = ${kParam} AND ${ISSUE_NUMBER_SORT_EXPR} < ${issueNumberParam}))`;
}

/**
 * The status window the default view consistently floors to: active issues (not
 * backlog, not done/closed) that are not archived. The `IN (...)` list is
 * derived from the shared `ACTIVE_STATUSES` lifecycle constant (REEF-109) so
 * the SQL floor, the board/timeline columns, and the report metrics all exclude
 * the same set. Each member is added to the supplied parameter builder.
 */
export function defaultViewStatusFloor(params: SqlParameterBuilder): string {
  const statuses = ACTIVE_STATUSES.map((s) =>
    params.add(s, "active status floor"),
  ).join(", ");
  return `"archived_at" IS NULL AND "status" IN (${statuses})`;
}

/**
 * The active-sprint id as an uncorrelated scalar subquery, mirroring the old
 * `getActiveSprint` deterministic pick: the lone `active` sprint, or — when
 * several are active — the most recent `start_date` (NULLs last), then the
 * highest `id`. Embedded in the default-view WHERE (REEF-324) so the landing
 * list resolves "current sprint" inside the single list query instead of a
 * separate planning round-trip. `reef_sprints.start_date` is a TEXT column, so
 * its lexical `DESC` sort equals chronological for ISO dates — the exact
 * ordering the JS tie-break used; `DESC NULLS LAST` keeps an undated sprint at
 * the tail (the JS path coalesced a null date to `""`, which sorted last).
 *
 * Unlike the JS path this does not skip a schema-malformed sprint row: a malformed
 * top-sorted active sprint would have its id used as the fallback scope. That
 * diverges in the edge where ≥2 sprints are active AND the most-recent one is malformed
 * — a negligible, data-degraded edge — and does not fail the query (the resilience
 * property is preserved; which sprint is picked could differ).
 */
function activeSprintIdSubquery(params: SqlParameterBuilder): string {
  return `(SELECT "id" FROM ${tableRef(
    REEF_SPRINTS_TABLE,
  )} WHERE "status" = ${params.add(
    "active",
    "active sprint status",
  )} ORDER BY "start_date" DESC NULLS LAST, "id" DESC LIMIT 1)`;
}

/**
 * The default-view WHERE for the issue list's first landing, folded into a
 * SINGLE self-contained predicate so the landing query needs no separate
 * active-sprint or "does this actor have any issue?" probe round-trips
 * (REEF-324) — the old path cost three akb calls (active sprint + My-Issues
 * probe + the list itself):
 *
 *   - the status-window floor (active, non-archived) consistently applies;
 *   - when an actor is known, the view narrows to My Issues *iff* the actor has
 *     any active issue, decided in-statement by an `EXISTS` subquery; with none
 *     it falls back to the active sprint (or the floor alone);
 *   - when no actor is known, it floors to the active sprint (or the floor).
 *
 * The caller resolves the actor (web cookie decode / akb actor); the active
 * sprint and the My-Issues test are SQL subqueries here rather than prior
 * round-trips. The active-sprint subquery returning NULL (no active sprint)
 * degrades to the floor alone, matching the old `getActiveSprint`→null behavior.
 * Every dynamic value is added to the supplied parameter builder.
 *
 * `withActiveSprint: false` drops the active-sprint fold entirely (no
 * `reef_sprints` reference). `listIssues` uses it to retry on a vault that has
 * `reef_issues` but not `reef_sprints` — a pre-planning vault where embedding the
 * sprint subquery would fail the whole query on the missing relation — so the
 * view still degrades to the floor / My Issues instead of a blank board, the same
 * resilience the old separate `getActiveSprint` call had.
 *
 * The `EXISTS` test does not reference the keyset cursor the caller appends, so
 * the resolved scope stays consistent across paginated pages — the up-front
 * scope invariant that kept page 2 from landing on an empty My-Issues set.
 */
export function buildDefaultViewWhere(
  params: {
    actor: string | null;
    withActiveSprint?: boolean;
  },
  sqlParams: SqlParameterBuilder,
): string {
  const floor = defaultViewStatusFloor(sqlParams);
  // The sprint arm: the active sprint when one exists, else the floor alone.
  // Dropped to a no-op (`TRUE` / omitted) when the sprint table is unavailable.
  const sprintFallback =
    params.withActiveSprint === false
      ? null
      : (() => {
          const sub = activeSprintIdSubquery(sqlParams);
          return `(${sub} IS NULL OR "sprint_id" = ${sub})`;
        })();
  if (!params.actor) {
    return sprintFallback ? `${floor} AND ${sprintFallback}` : floor;
  }
  const actorParam = sqlParams.add(params.actor, "default view actor");
  const actorEq = `"assigned_to" = ${actorParam}`;
  const hasMine = `EXISTS (SELECT 1 FROM ${tableRef(
    REEF_ISSUES_TABLE,
  )} WHERE ${floor} AND ${actorEq})`;
  // No sprint table → the no-My-Issues arm is just the floor (`TRUE` under the
  // outer floor), i.e. My Issues when the actor has any, else the floor.
  const elseArm = sprintFallback ?? "TRUE";
  return `${floor} AND ((${hasMine} AND ${actorEq}) OR (NOT ${hasMine} AND ${elseArm}))`;
}
