import { z } from "zod";
import {
  IssueTypeEnum,
  PriorityEnum,
  SeverityEnum,
  StatusEnum,
} from "./metadata";
import { USER_SORT_FIELDS } from "./requests";

/**
 * Persisted representation of the client issue filter — the payload that crosses
 * the browser↔IndexedDB boundary (REEF-009). Enums are reused by reference from
 * `metadata.ts` / `requests.ts` (single canonical source — values are not
 * re-listed here).
 *
 * Why not derive from `IssueMetadataSchema` via `.pick()`: that schema is the
 * snake_case akb-document shape (`nullable()` wrappers, required `status`,
 * document fields like `created_by` / `created_at`), which does not match
 * the camelCase client filter. We derive from the shared enums just — keeping
 * the enum as the single canonical source without coupling to the document shape.
 *
 * `searchQuery` and the retired `search` are intentionally absent — search is
 * one-off exploration, not restored (REEF-009 decision #1). View mode (`?view=`)
 * is URL and likewise absent.
 *
 * Each field uses `.optional().catch(undefined)` so a single stale/garbage value (e.g. a
 * `status` enum member removed in a later release) is dropped to `undefined`
 * while its valid siblings survive — implementing AC5 ("drop invalid fields,
 * fall back to safe defaults") at field granularity. `z.object` also strips
 * unknown keys, so a field removed from a later schema is silently dropped.
 *
 * `sortField` restores just `USER_SORT_FIELDS` (the dropdown-selectable set); a
 * persisted/shared `rank` sort is dropped, matching the UI which does not offers
 * it. The resulting type is assignable to the web `IssueFilter`, so the store
 * type stays as-is.
 *
 * NOTE (forward-compat): this is a persisted schema, so the strict-JSON-
 * Schema conventions for AI-SDK tool inputs (every prop required, `z.nullable()`
 * for optional, `.default()` for defaults) do NOT apply. If this schema is ever
 * reused as a mutating tool's `inputSchema`, re-validate it against those rules.
 */
/**
 * A multi-select facet (REEF-031): an array of enum members.
 *
 * On read it also accepts a older single scalar value and normalizes it to a
 * one-element array. Pre-REEF-031 saved filters stored these facets as a single
 * string (`status: "todo"`); without this coercion an upgrade would silently
 * drop the user's saved filter via `.catch(undefined)`. This mirrors the URL
 * reader, which already widens a single `?status=todo` to `["todo"]`, so the
 * persisted slot stays forward/reverse compatible without an envelope-version
 * bump (which would hard-discard the whole saved filter).
 *
 * `.catch(undefined)` still drops the whole facet when a value is not a valid
 * member (field-level AC5); valid sibling facets survive.
 */
function multiEnumFacet<T extends z.ZodTypeAny>(member: T) {
  return z
    .preprocess(
      (v) => (v == null || Array.isArray(v) ? v : [v]),
      z.array(member),
    )
    .optional()
    .catch(undefined);
}

/**
 * A multi-select facet of free-form strings — assignee / requester / sprint /
 * release (REEF-267). Same scalar→array read coercion as `multiEnumFacet`, so a
 * pre-REEF-267 saved filter that stored `assignee: "alice"` upgrades to
 * `["alice"]` instead of being dropped by `.catch(undefined)`; mirrors the URL
 * reader widening a single `?assignee=alice` to `["alice"]`. No enum membership
 * to validate, so the inner element is a plain string.
 */
function multiStringFacet() {
  return z
    .preprocess(
      (v) => (v == null || Array.isArray(v) ? v : [v]),
      z.array(z.string()),
    )
    .optional()
    .catch(undefined);
}

export const PersistedIssueFilterSchema = z.object({
  status: multiEnumFacet(StatusEnum),
  issueType: multiEnumFacet(IssueTypeEnum),
  priority: multiEnumFacet(PriorityEnum),
  assignee: multiStringFacet(),
  requester: multiStringFacet(),
  reporter: z.string().optional().catch(undefined),
  severity: multiEnumFacet(SeverityEnum),
  sprint_id: multiStringFacet(),
  // milestone_id stays a single scalar — multi-select out of scope (REEF-267).
  milestone_id: z.string().optional().catch(undefined),
  release_id: multiStringFacet(),
  due: multiEnumFacet(z.enum(["overdue", "due_soon"])),
  label: z.string().optional().catch(undefined),
  dependencyFilter: multiEnumFacet(z.enum(["blocked", "blocking"])),
  showArchived: z.boolean().optional().catch(undefined),
  showStale: z.boolean().optional().catch(undefined),
  sortField: z.enum(USER_SORT_FIELDS).optional().catch(undefined),
  sortOrder: z.enum(["asc", "desc"]).optional().catch(undefined),
});

/**
 * Versioned envelope stored in IndexedDB. A version mismatch fails the reader's
 * `safeParse` → the whole payload is discarded and the filter falls back to
 * empty (hard discard; a future schema change bumps `version`). This is a
 * value-level safety lever, distinct from Dexie's DB-structure versioning.
 */
export const PersistedIssueFilterEnvelopeSchema = z.object({
  version: z.literal(1),
  filter: PersistedIssueFilterSchema,
});

export type PersistedIssueFilter = z.infer<typeof PersistedIssueFilterSchema>;
