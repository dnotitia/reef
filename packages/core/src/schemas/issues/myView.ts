import { z } from "zod";
import { naturalSortOrder } from "./fieldRegistry";
import { USER_SORT_FIELDS } from "./requests";
import {
  PersistedIssueFilterSchema,
  normalizePersistedIssueFilter,
  type PersistedIssueFilter,
} from "./persistedIssueFilter";

export const MY_VIEW_VERSION = 1 as const;

const MY_VIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const MY_VIEW_NAME_MAX_LENGTH = 80;

export const MyViewScopeEnum = z.enum(["active", "backlog"]);
export const MyViewLayoutEnum = z.enum(["board", "list", "timeline"]);
export const MyViewGroupByEnum = z.enum([
  "none",
  "status",
  "assignee",
  "priority",
  "sprint",
  "label",
  "epic",
]);
export const MyViewListColumnEnum = z.enum([
  "start",
  "sprint",
  "milestone",
  "release",
]);

export type MyViewScope = z.infer<typeof MyViewScopeEnum>;
export type MyViewLayout = z.infer<typeof MyViewLayoutEnum>;
export type MyViewGroupBy = z.infer<typeof MyViewGroupByEnum>;
export type MyViewListColumn = z.infer<typeof MyViewListColumnEnum>;

export const MyViewFilterSchema = PersistedIssueFilterSchema.omit({
  showArchived: true,
  showStale: true,
  sortField: true,
  sortOrder: true,
  orderingMode: true,
});

export const MyViewOrderingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("manual") }),
  z.object({
    mode: z.literal("field"),
    field: z.enum(USER_SORT_FIELDS),
    direction: z.enum(["asc", "desc"]),
  }),
]);

export const MyViewDisplayConfigSchema = z.object({
  showArchived: z.literal(true).optional(),
  showStale: z.literal(true).optional(),
  listColumns: z.array(MyViewListColumnEnum).optional(),
});

export const MyViewSnapshotSchema = z.object({
  filter: MyViewFilterSchema,
  scope: MyViewScopeEnum,
  layout: MyViewLayoutEnum,
  grouping: MyViewGroupByEnum,
  ordering: MyViewOrderingSchema,
  display: MyViewDisplayConfigSchema,
});

export type MyViewFilter = z.infer<typeof MyViewFilterSchema>;
export type MyViewOrdering = z.infer<typeof MyViewOrderingSchema>;
export type MyViewDisplayConfig = z.infer<typeof MyViewDisplayConfigSchema>;
export type MyViewSnapshot = z.infer<typeof MyViewSnapshotSchema>;

export const MyViewEnvelopeSchema = z.object({
  version: z.literal(MY_VIEW_VERSION),
  id: z.string().regex(MY_VIEW_ID_PATTERN),
  name: z.string().min(1).max(MY_VIEW_NAME_MAX_LENGTH),
  nameKey: z.string().min(1),
  owner: z.string().min(1).max(256),
  vault: z.string().min(1).max(256),
  snapshot: MyViewSnapshotSchema,
});

const MyViewEnvelopeInputSchema = z.object({
  version: z.literal(MY_VIEW_VERSION),
  id: z.string().regex(MY_VIEW_ID_PATTERN),
  name: z.string().min(1).max(MY_VIEW_NAME_MAX_LENGTH),
  nameKey: z.string().min(1),
  owner: z.string().min(1).max(256),
  vault: z.string().min(1).max(256),
  snapshot: z.unknown(),
});

export type MyViewEnvelope = z.infer<typeof MyViewEnvelopeSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeName(name: string): string {
  if (typeof name !== "string") {
    throw new TypeError("My View name must be a string");
  }
  const normalized = name.normalize("NFKC").trim();
  if (!normalized) throw new TypeError("My View name is required");
  if (normalized.length > MY_VIEW_NAME_MAX_LENGTH) {
    throw new RangeError(
      `My View name must be ${MY_VIEW_NAME_MAX_LENGTH} characters or fewer`,
    );
  }
  return normalized;
}

export function canonicalizeMyViewName(name: string): string {
  return normalizeName(name).toLowerCase();
}

function normalizeListColumns(value: unknown): MyViewListColumn[] {
  if (!Array.isArray(value)) return [];
  const values = new Set(
    value.flatMap((candidate) => {
      const parsed = MyViewListColumnEnum.safeParse(candidate);
      return parsed.success ? [parsed.data] : [];
    }),
  );
  return MyViewListColumnEnum.options.filter((column) => values.has(column));
}

function defaultGrouping(
  scope: MyViewScope,
  layout: MyViewLayout,
): MyViewGroupBy {
  if (layout === "timeline") return "none";
  if (scope === "backlog") return "priority";
  return layout === "board" ? "status" : "none";
}

function normalizeGrouping(
  value: unknown,
  scope: MyViewScope,
  layout: MyViewLayout,
): MyViewGroupBy {
  const parsed = MyViewGroupByEnum.safeParse(value);
  if (!parsed.success) return defaultGrouping(scope, layout);
  if (layout === "timeline") return "none";
  if (scope === "backlog" && !["none", "priority"].includes(parsed.data)) {
    return defaultGrouping(scope, layout);
  }
  if (scope === "active" && layout === "board" && parsed.data === "none") {
    return defaultGrouping(scope, layout);
  }
  return parsed.data;
}

function normalizeOrdering(value: unknown): MyViewOrdering {
  if (!isRecord(value)) return { mode: "manual" };
  if (value.mode === "manual") return { mode: "manual" };
  if (value.mode !== "field") return { mode: "manual" };

  const field = z.enum(USER_SORT_FIELDS).safeParse(value.field);
  if (!field.success) return { mode: "manual" };
  const direction = z.enum(["asc", "desc"]).safeParse(value.direction);
  return {
    mode: "field",
    field: field.data,
    direction: direction.success
      ? direction.data
      : naturalSortOrder(field.data),
  };
}

function normalizeFilter(value: unknown): MyViewFilter {
  const normalized = normalizePersistedIssueFilter(value);
  const parsed = MyViewFilterSchema.safeParse(normalized);
  if (!parsed.success) return {};
  const filter: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(parsed.data)) {
    if (fieldValue !== undefined) filter[key] = fieldValue;
  }
  return filter as MyViewFilter;
}

function normalizeDisplay(value: unknown): MyViewDisplayConfig {
  const input = isRecord(value) ? value : {};
  const display: Record<string, unknown> = {};
  if (input.showArchived === true) display.showArchived = true;
  if (input.showStale === true) display.showStale = true;
  const listColumns = normalizeListColumns(input.listColumns);
  if (listColumns.length > 0) display.listColumns = listColumns;
  return MyViewDisplayConfigSchema.parse(display);
}

/** Normalizes supported workspace state without accepting issue order data. */
export function normalizeMyViewSnapshot(value: unknown): MyViewSnapshot | null {
  if (!isRecord(value)) return null;
  const scope = MyViewScopeEnum.safeParse(value.scope).success
    ? (value.scope as MyViewScope)
    : "active";
  const parsedLayout = MyViewLayoutEnum.safeParse(value.layout);
  const layout =
    scope === "backlog" &&
    parsedLayout.success &&
    parsedLayout.data === "timeline"
      ? "list"
      : parsedLayout.success
        ? parsedLayout.data
        : "board";
  const ordering = normalizeOrdering(value.ordering);
  const snapshot = {
    filter: normalizeFilter(value.filter),
    scope,
    layout,
    grouping: normalizeGrouping(value.grouping, scope, layout),
    ordering,
    display: normalizeDisplay(value.display),
  };
  return MyViewSnapshotSchema.parse(snapshot);
}

export function buildMyViewEnvelope(input: {
  id: string;
  name: string;
  owner: string;
  vault: string;
  snapshot: unknown;
}): MyViewEnvelope {
  const name = normalizeName(input.name);
  const owner = input.owner.trim();
  const vault = input.vault.trim();
  if (!owner) throw new TypeError("My View owner is required");
  if (!vault) throw new TypeError("My View vault is required");
  const snapshot = normalizeMyViewSnapshot(input.snapshot);
  if (!snapshot) throw new TypeError("My View snapshot is invalid");
  return MyViewEnvelopeSchema.parse({
    version: MY_VIEW_VERSION,
    id: input.id,
    name,
    nameKey: canonicalizeMyViewName(name),
    owner,
    vault,
    snapshot,
  });
}

/** Reads a stored envelope and drops unknown or unsupported representations. */
export function normalizeMyViewEnvelope(value: unknown): MyViewEnvelope | null {
  const parsed = MyViewEnvelopeInputSchema.safeParse(value);
  if (!parsed.success) return null;
  try {
    return buildMyViewEnvelope(parsed.data);
  } catch {
    return null;
  }
}

export function serializeMyViewSnapshot(value: unknown): string {
  const snapshot = normalizeMyViewSnapshot(value);
  return snapshot ? JSON.stringify(snapshot) : "";
}
