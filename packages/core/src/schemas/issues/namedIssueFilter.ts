import { z } from "zod";
import { naturalSortOrder } from "./fieldRegistry";
import {
  IssueTypeEnum,
  PriorityEnum,
  SeverityEnum,
  StatusEnum,
} from "./metadata";
import {
  type PersistedIssueFilter,
  PersistedIssueFilterSchema,
} from "./persistedIssueFilter";
import { USER_SORT_FIELDS } from "./requests";

export const NAMED_ISSUE_FILTER_VERSION = 1 as const;

const NAMED_ISSUE_FILTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const NAMED_ISSUE_FILTER_NAME_MAX_LENGTH = 80;

export const NamedIssueFilterEnvelopeSchema = z.object({
  version: z.literal(NAMED_ISSUE_FILTER_VERSION),
  id: z.string().regex(NAMED_ISSUE_FILTER_ID_PATTERN),
  name: z.string().min(1).max(NAMED_ISSUE_FILTER_NAME_MAX_LENGTH),
  nameKey: z.string().min(1),
  payload: PersistedIssueFilterSchema,
});

const NamedIssueFilterEnvelopeInputSchema = z.object({
  version: z.literal(NAMED_ISSUE_FILTER_VERSION),
  id: z.string().regex(NAMED_ISSUE_FILTER_ID_PATTERN),
  name: z.string().min(1).max(NAMED_ISSUE_FILTER_NAME_MAX_LENGTH),
  nameKey: z.string().min(1),
  payload: z.unknown(),
});

export type NamedIssueFilterEnvelope = z.infer<
  typeof NamedIssueFilterEnvelopeSchema
>;

const ARRAY_PAYLOAD_SCHEMAS: Record<string, z.ZodType<string>> = {
  status: StatusEnum,
  issueType: IssueTypeEnum,
  priority: PriorityEnum,
  assignee: z.string(),
  requester: z.string(),
  severity: SeverityEnum,
  sprint_id: z.string(),
  release_id: z.string(),
  due: z.enum(["overdue", "due_soon"]),
  dependencyFilter: z.enum(["blocked", "blocking"]),
};

const ARRAY_PAYLOAD_KEYS = Object.keys(ARRAY_PAYLOAD_SCHEMAS);
const SCALAR_STRING_PAYLOAD_KEYS = ["reporter", "milestone_id"] as const;

const SORT_FIELD_SCHEMA = z.enum(USER_SORT_FIELDS);
const SORT_ORDER_SCHEMA = z.enum(["asc", "desc"]);

const PAYLOAD_KEYS = [
  "status",
  "issueType",
  "priority",
  "assignee",
  "requester",
  "severity",
  "sprint_id",
  "release_id",
  "due",
  "dependencyFilter",
  "label",
  "showArchived",
  "showStale",
  "sortField",
  "sortOrder",
] as const;

/**
 * Returns the display form used for a stored filter name. NFKC makes visually
 * equivalent input stable while trim keeps the name useful in compact menus.
 */
export function normalizeNamedIssueFilterDisplayName(name: string): string {
  if (typeof name !== "string") {
    throw new TypeError("named issue filter name must be a string");
  }
  const normalized = name.normalize("NFKC").trim();
  if (!normalized) {
    throw new TypeError("named issue filter name is required");
  }
  if (normalized.length > NAMED_ISSUE_FILTER_NAME_MAX_LENGTH) {
    throw new RangeError(
      `named issue filter name must be ${NAMED_ISSUE_FILTER_NAME_MAX_LENGTH} characters or fewer`,
    );
  }
  return normalized;
}

/** Returns the duplicate-detection key for a display name. */
export function canonicalizeNamedIssueFilterName(name: string): string {
  return normalizeNamedIssueFilterDisplayName(name).toLowerCase();
}

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
 * Sanitizes and canonicalizes the filter payload shared by storage, active
 * matching, and CRUD updates. Invalid fields are dropped by the persisted
 * schema, empty array members are removed, arrays are sorted and deduplicated,
 * and an order can never exist without its sort field.
 */
export function normalizeNamedIssueFilterPayload(
  value: unknown,
): PersistedIssueFilter {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const input = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of ARRAY_PAYLOAD_KEYS) {
    const fieldValue = input[key];
    if (fieldValue === undefined || fieldValue === null) continue;
    const candidates = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
    const memberSchema = ARRAY_PAYLOAD_SCHEMAS[key];
    const members = candidates.flatMap((candidate) => {
      const parsed = memberSchema.safeParse(candidate);
      return parsed.success ? [parsed.data] : [];
    });
    const canonicalMembers = canonicalStringList(members);
    if (canonicalMembers.length > 0) normalized[key] = canonicalMembers;
  }

  for (const key of SCALAR_STRING_PAYLOAD_KEYS) {
    const parsed = z.string().safeParse(input[key]);
    if (parsed.success && parsed.data.trim()) {
      normalized[key] = parsed.data.trim();
    }
  }

  if (typeof input.label === "string") {
    const label = canonicalLabelFilter(input.label);
    if (label) normalized.label = label;
  }
  if (input.showArchived === true) normalized.showArchived = true;
  if (input.showStale === true) normalized.showStale = true;

  const sortField = SORT_FIELD_SCHEMA.safeParse(input.sortField);
  const sortOrder = SORT_ORDER_SCHEMA.safeParse(input.sortOrder);
  if (sortField.success) {
    normalized.sortField = sortField.data;
    normalized.sortOrder = sortOrder.success
      ? sortOrder.data
      : naturalSortOrder(sortField.data);
  }

  const ordered: Record<string, unknown> = {};
  for (const key of PAYLOAD_KEYS) {
    if (normalized[key] !== undefined) ordered[key] = normalized[key];
  }

  const parsed = PersistedIssueFilterSchema.safeParse(ordered);
  return parsed.success ? parsed.data : {};
}

export function hasNamedIssueFilterPayload(value: unknown): boolean {
  return Object.keys(normalizeNamedIssueFilterPayload(value)).length > 0;
}

export function serializeNamedIssueFilterPayload(value: unknown): string {
  return JSON.stringify(normalizeNamedIssueFilterPayload(value));
}

export function buildNamedIssueFilterEnvelope(input: {
  id: string;
  name: string;
  payload: unknown;
}): NamedIssueFilterEnvelope {
  const name = normalizeNamedIssueFilterDisplayName(input.name);
  return NamedIssueFilterEnvelopeSchema.parse({
    version: NAMED_ISSUE_FILTER_VERSION,
    id: input.id,
    name,
    nameKey: canonicalizeNamedIssueFilterName(name),
    payload: normalizeNamedIssueFilterPayload(input.payload),
  });
}

/**
 * Reads one persisted envelope defensively. A valid envelope with malformed
 * fields remains visible with a sanitized payload so the user can delete or
 * rename it without allowing bad data to break issue browsing.
 */
export function normalizeNamedIssueFilterEnvelope(
  value: unknown,
): NamedIssueFilterEnvelope | null {
  const parsed = NamedIssueFilterEnvelopeInputSchema.safeParse(value);
  if (!parsed.success) return null;
  try {
    return buildNamedIssueFilterEnvelope({
      ...parsed.data,
      payload: parsed.data.payload ?? {},
    });
  } catch {
    return null;
  }
}
