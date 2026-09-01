import { z } from "zod";
import { naturalSortOrder } from "./fieldRegistry";
import {
  IssueTypeEnum,
  PriorityEnum,
  SeverityEnum,
  StatusEnum,
} from "./metadata";
import { IssueOrderingModeEnum, USER_SORT_FIELDS } from "./requests";

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
 * Each persisted field uses `.optional().catch(undefined)` so a single stale/garbage value (e.g. a
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
function multiEnumFacet<T extends z.ZodType>(member: T) {
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
  priorityUnset: z.literal(true).optional().catch(undefined),
  assignee: multiStringFacet(),
  assigneeUnset: z.literal(true).optional().catch(undefined),
  requester: multiStringFacet(),
  reporter: z.string().optional().catch(undefined),
  severity: multiEnumFacet(SeverityEnum),
  severityUnset: z.literal(true).optional().catch(undefined),
  sprint_id: multiStringFacet(),
  // milestone_id stays a single scalar — multi-select out of scope (REEF-267).
  milestone_id: z.string().optional().catch(undefined),
  release_id: multiStringFacet(),
  due: multiEnumFacet(z.enum(["overdue", "due_soon", "no_due"])),
  label: z.string().optional().catch(undefined),
  dependencyFilter: multiEnumFacet(z.enum(["blocked", "blocking"])),
  showArchived: z.boolean().optional().catch(undefined),
  showStale: z.boolean().optional().catch(undefined),
  sortField: z.enum(USER_SORT_FIELDS).optional().catch(undefined),
  sortOrder: z.enum(["asc", "desc"]).optional().catch(undefined),
  orderingMode: IssueOrderingModeEnum.optional().catch(undefined),
});

const ARRAY_FILTER_SCHEMAS: Record<string, z.ZodType<string>> = {
  status: StatusEnum,
  issueType: IssueTypeEnum,
  priority: PriorityEnum,
  assignee: z.string(),
  requester: z.string(),
  severity: SeverityEnum,
  sprint_id: z.string(),
  release_id: z.string(),
  due: z.enum(["overdue", "due_soon", "no_due"]),
  dependencyFilter: z.enum(["blocked", "blocking"]),
};

const ARRAY_FILTER_KEYS = Object.keys(ARRAY_FILTER_SCHEMAS);
const SCALAR_FILTER_KEYS = ["reporter", "milestone_id"] as const;
const FILTER_KEYS = [
  "status",
  "issueType",
  "priority",
  "priorityUnset",
  "assignee",
  "assigneeUnset",
  "requester",
  "reporter",
  "severity",
  "severityUnset",
  "sprint_id",
  "milestone_id",
  "release_id",
  "due",
  "label",
  "dependencyFilter",
  "showArchived",
  "showStale",
  "sortField",
  "sortOrder",
  "orderingMode",
] as const;

function canonicalStringList(value: readonly string[]): string[] {
  const members = value
    .map((member) => member.trim())
    .filter((member) => member.length > 0);
  return [...new Set(members)].sort();
}

function canonicalLabelFilter(value: string): string | undefined {
  const labels = canonicalStringList(
    value.split(",").map((label) => label.toLowerCase()),
  );
  return labels.length > 0 ? labels.join(",") : undefined;
}

/**
 * Sanitizes the filter portion shared by IndexedDB and My View snapshots.
 * Invalid fields are dropped independently, arrays are sorted/deduplicated,
 * and a sort direction is kept only when its field is valid.
 */
export function normalizePersistedIssueFilter(
  value: unknown,
): PersistedIssueFilter {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const input = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const key of ARRAY_FILTER_KEYS) {
    const fieldValue = input[key];
    if (fieldValue === undefined || fieldValue === null) continue;
    const candidates = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
    const memberSchema = ARRAY_FILTER_SCHEMAS[key];
    const members = candidates.flatMap((candidate) => {
      const parsed = memberSchema.safeParse(candidate);
      return parsed.success ? [parsed.data] : [];
    });
    const canonicalMembers = canonicalStringList(members);
    if (canonicalMembers.length > 0) normalized[key] = canonicalMembers;
  }

  for (const key of SCALAR_FILTER_KEYS) {
    const parsed = z.string().safeParse(input[key]);
    if (parsed.success && parsed.data.trim()) {
      normalized[key] = parsed.data.trim();
    }
  }

  if (typeof input.label === "string") {
    const label = canonicalLabelFilter(input.label);
    if (label) normalized.label = label;
  }
  if (input.priorityUnset === true) normalized.priorityUnset = true;
  if (input.severityUnset === true) normalized.severityUnset = true;
  if (input.assigneeUnset === true) normalized.assigneeUnset = true;
  if (input.showArchived === true) normalized.showArchived = true;
  if (input.showStale === true) normalized.showStale = true;

  const sortField = z.enum(USER_SORT_FIELDS).safeParse(input.sortField);
  const sortOrder = z.enum(["asc", "desc"]).safeParse(input.sortOrder);
  if (sortField.success) {
    normalized.sortField = sortField.data;
    normalized.sortOrder = sortOrder.success
      ? sortOrder.data
      : naturalSortOrder(sortField.data);
    normalized.orderingMode = "field";
  } else if (input.orderingMode === "manual") {
    normalized.orderingMode = "manual";
  }

  const ordered: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) {
    if (normalized[key] !== undefined) ordered[key] = normalized[key];
  }

  const parsed = PersistedIssueFilterSchema.safeParse(ordered);
  return parsed.success ? parsed.data : {};
}

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
