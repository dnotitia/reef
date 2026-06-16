import { z } from "zod";
import { MAX_REORDER_WRITES } from "../../models/backlogRank";
import { IsoDateFieldSchema } from "../common/date";
import {
  IssueCreateInputSchema,
  IssueListItemSchema,
  IssueTypeEnum,
  PriorityEnum,
  SeverityEnum,
  StatusEnum,
} from "./metadata";
import { AKB_DOCUMENT_URI_RE } from "./references";

/**
 * Request body for POST /api/issues — commits a human or AI issue proposal to
 * the akb vault.
 * `vault` is the active workspace name. `prefix` is the project_prefix
 * sourced from the vault's `_reef/config` doc.
 */
export const CreateIssueRequestSchema = z
  .object({
    vault: z.string().min(1),
    create: IssueCreateInputSchema,
    prefix: z.string().min(1),
    /**
     * akb document URIs to link to the new issue as `references` relation edges
     * once it is created (REEF-083 AC4 — AI enrichment or a PM cites supporting
     * documents). The issue has no id until the server allocates one, so document
     * references ride along on the create request and are linked post-write
     * rather than being an issue field.
     *
     * Capped and de-duplicated at the boundary: the create handler fans each entry
     * out into a sequential `addIssueReference` call, so an unbounded array would
     * let one request trigger thousands of akb relation writes. The cap is well
     * above any realistic hand-curated set.
     */
    references: z
      .array(z.string().regex(AKB_DOCUMENT_URI_RE))
      .max(50)
      .transform((uris) => Array.from(new Set(uris)))
      .optional(),
  })
  .refine(
    // Cross-vault guard: a reference target should live in the request's own vault.
    // akb's link surface rejects a cross-vault edge too, but failing here keeps a
    // mismatched URI out of the best-effort post-create link loop entirely.
    (req) =>
      (req.references ?? []).every(
        (uri) => /^akb:\/\/([^/]+)\//.exec(uri)?.[1] === req.vault,
      ),
    {
      message: "every reference must belong to the request vault",
      path: ["references"],
    },
  );

/**
 * User-selectable sort columns — the set surfaced in the issue list's sort
 * control. `rank` is deliberately excluded: it is server-managed manual
 * ordering, not a value the user picks. The persisted-filter schema (REEF-009)
 * restores these, so a stale/shared `?sort=rank` is dropped on restore,
 * matching a UI that does not offers it. This is also the single source for the
 * user-facing sort values.
 *
 * `priority` sorts by a CASE rank and `estimate_points` by a COALESCE'd numeric
 * (see the adapter's `sortLeadExpr` / `NUMERIC_SORT_FIELDS`); `title` is a
 * case-aware text sort; the rest are direct columns.
 */
export const USER_SORT_FIELDS = [
  "created_at",
  "updated_at",
  "priority",
  "start_date",
  "due_date",
  "estimate_points",
  "title",
] as const;

/**
 * The user-selectable sort fields as a union type — the single source for
 * typing the web filter store's `sortField`, the display-metadata maps in
 * `fieldRegistry`, and any consumer that should stay in lockstep with
 * `USER_SORT_FIELDS`. Excludes the server-managed `rank` (see `SORT_FIELDS`).
 */
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

/**
 * Sortable columns for the issue list. `priority` sorts by a CASE rank (see the
 * adapter's `priorityRankCase`); the rest are direct `reef_issues` columns.
 * `rank` is the server-managed manual order and is not user-selectable (see
 * `USER_SORT_FIELDS`).
 */
const SORT_FIELDS = [...USER_SORT_FIELDS, "rank"] as const;

/**
 * Default issue sort when the user has not picked one (REEF-057): priority
 * high→low, with the server adding a `reef_id` tiebreaker (see the adapter's
 * `buildIssueOrderBy`). This is the single source for the default; it is applied
 * at the query-building layer (`buildIssueQuery`) just — does not written into the
 * filter store / URL / persisted slot — so "no explicit sort" stays pristine for
 * URL-sync and persistence while the board and list still render deterministically.
 */
export const DEFAULT_ISSUE_SORT_FIELD =
  "priority" satisfies (typeof USER_SORT_FIELDS)[number];
export const DEFAULT_ISSUE_SORT_ORDER = "desc" satisfies "asc" | "desc";

/**
 * Query params for GET /api/issues — the server-side filter / sort / pagination
 * contract. Derived from `IssueMetadataSchema`'s enums (single canonical source);
 * snake_case on the wire. Multi-value facets are arrays → SQL `IN`. The Route
 * Handler coerces the raw query string into this shape (repeated params →
 * arrays, `"true"` → boolean, numeric `limit`) before parsing.
 */
/**
 * A keyset cursor is opaque `base64url(JSON({k,id}))`. Validate decodability at
 * the request boundary so a malformed cursor is a 400 (bad query) rather than
 * surfacing later as a deeper adapter/schema error.
 */
function isDecodableCursor(cursor: string): boolean {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf-8"),
    );
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { k?: unknown }).k === "string" &&
      typeof (parsed as { id?: unknown }).id === "string"
    );
  } catch {
    return false;
  }
}

export const IssueListQuerySchema = z.object({
  status: z.array(StatusEnum).optional(),
  priority: z.array(PriorityEnum).optional(),
  severity: z.array(SeverityEnum).optional(),
  issue_type: z.array(IssueTypeEnum).optional(),
  assigned_to: z.string().min(1).optional(),
  requester: z.string().min(1).optional(),
  sprint_id: z.string().min(1).optional(),
  milestone_id: z.string().min(1).optional(),
  release_id: z.string().min(1).optional(),
  due_before: IsoDateFieldSchema.optional(),
  due_after: IsoDateFieldSchema.optional(),
  archived: z.boolean().default(false),
  /**
   * When true, the server resolves the narrow default landing view (My Issues
   * → active sprint → status-window floor) instead of the explicit facets.
   * The actor for "My Issues" is derived server-side from the session, does not
   * from the wire.
   */
  default_view: z.boolean().default(false),
  q: z.string().min(1).optional(),
  // No defaults: an explicit sort is just applied when the client selects one
  // (the adapter falls back to a stable order when paginating). Defaulting
  // here would silently re-order every filtered list by priority.
  sort_field: z.enum(SORT_FIELDS).optional(),
  sort_order: z.enum(["asc", "desc"]).optional(),
  cursor: z
    .string()
    .min(1)
    .refine(isDecodableCursor, "invalid pagination cursor")
    .optional(),
  // No default: an absent limit means "no pagination" (return the full filtered
  // set). Pagination is opt-in — a consumer that paginates passes an explicit
  // limit and follows `next_cursor`. Defaulting here would silently cap every
  // filtered list at 50 with no cursor follow-up in non-paginated consumers.
  limit: z.number().int().min(1).max(100).optional(),
});

export type IssueListQuery = z.infer<typeof IssueListQuerySchema>;

/**
 * Response body for GET /api/issues. `items` reuses the existing list
 * projection; `next_cursor` is the opaque keyset cursor for the next page (null
 * at the end); `column_counts` is the per-status total for board headers (null
 * when the vault has no issue table yet, any status absent implicitly zero).
 */
export const IssueListResponseSchema = z.object({
  issues: z.array(IssueListItemSchema),
  // Optional so this contract validates BOTH the older unpaginated `{ issues }`
  // response and the paginated envelope (returned when `limit` is present).
  next_cursor: z.string().nullable().optional(),
  column_counts: z
    .record(z.string(), z.number().int().nonnegative())
    .nullable()
    .optional(),
});

/**
 * Body for POST /api/issues/reorder — the backlog drag-reorder write (REEF-129).
 * `assignments` is the set of `rank` writes a single drag produced (from
 * `computeReorderedRanks`); the server applies them as one atomic SQL update.
 * `rank` is finite (fractional midpoints and negative top-inserts are valid).
 *
 * The cap is `MAX_REORDER_WRITES` — the SAME bound `computeReorderedRanks`
 * clamps its output to — so a valid drag can not be rejected as malformed,
 * while still bounding a hostile payload. It is shared, not a second guess at
 * "how big is a backlog".
 */
export const BacklogReorderRequestSchema = z.object({
  vault: z.string().min(1),
  assignments: z
    .array(z.object({ id: z.string().min(1), rank: z.number().finite() }))
    .min(1)
    .max(MAX_REORDER_WRITES),
});

/**
 * A single node of the whole-vault relation projection — the minimal shape the
 * client needs to compute blocker badges and the blocked/blocking dependency
 * filter without fetching every issue's body. `id` is the reef id; `depends_on`
 * holds the reef ids this issue depends on.
 */
export const IssueRelationSchema = z.object({
  id: z.string(),
  status: StatusEnum,
  depends_on: z.array(z.string()),
});

export type IssueRelation = z.infer<typeof IssueRelationSchema>;

/**
 * The narrowing filter facets — everything that shrinks the result set,
 * excluding sort/pagination and the (widening) `archived` toggle. Drives the
 * "explicit filter vs server default view" decision in the GET handler.
 */
const FILTER_FACET_KEYS = [
  "status",
  "priority",
  "severity",
  "issue_type",
  "assigned_to",
  "requester",
  "sprint_id",
  "milestone_id",
  "release_id",
  "due_before",
  "due_after",
  "q",
] as const;

/**
 * True when the query carries at least one narrowing facet — in which case the
 * server honors the explicit filter instead of applying its default view. The
 * `archived` toggle widens rather than narrows, so it does not count.
 */
export function hasAnyFilter(query: IssueListQuery): boolean {
  return FILTER_FACET_KEYS.some((key) => {
    const value = query[key];
    return Array.isArray(value) ? value.length > 0 : value != null;
  });
}
