import { z } from "zod";

/**
 * The storage semantics a date field exposes to the shared range module.
 * Timestamp fields compare instants; date-only fields compare calendar days.
 */
export type IssueDateFieldStorage = "timestamp" | "date-only";

/**
 * One registered issue date field. `column` is trusted registry data, never a
 * value selected by a caller, so SQL builders can not turn an arbitrary field
 * string into an identifier.
 */
export interface IssueDateField {
  readonly id: string;
  readonly label: string;
  readonly storage: IssueDateFieldStorage;
  readonly nullable: boolean;
  readonly column: string;
}

/**
 * The date criteria currently enabled for issue views. Future criteria extend
 * this registry without changing the range value or its consumers.
 */
export const ISSUE_DATE_FIELD_REGISTRY = {
  updated_at: {
    id: "updated_at",
    label: "Updated",
    storage: "timestamp",
    nullable: false,
    column: "updated_at",
  },
} as const satisfies Readonly<Record<string, IssueDateField>>;

export type IssueDateFieldId = keyof typeof ISSUE_DATE_FIELD_REGISTRY;

export function getIssueDateField(
  field: string,
  registry: Readonly<
    Record<string, IssueDateField>
  > = ISSUE_DATE_FIELD_REGISTRY,
): IssueDateField | undefined {
  const definition = registry[field];
  return definition?.id === field ? definition : undefined;
}

/** A user-facing calendar range. Empty bounds represent an incomplete choice. */
export const IssueDateRangeSchema = z.object({
  field: z.string().min(1),
  from: z.string(),
  to: z.string(),
});

export type IssueDateRange = z.infer<typeof IssueDateRangeSchema>;

/** A range after its calendar dates have been normalized for a query. */
export const IssueDateRangeQuerySchema = z
  .object({
    field: z.string().min(1),
    from: z
      .string()
      .refine(isValidDateBoundary, "date range start must be a valid ISO date"),
    to: z
      .string()
      .refine(isValidDateBoundary, "date range end must be a valid ISO date"),
  })
  .superRefine((range, ctx) => {
    if (!getIssueDateField(range.field)) {
      ctx.addIssue({
        code: "custom",
        path: ["field"],
        message: "date range field is not registered",
      });
    }
    if (Date.parse(range.from) >= Date.parse(range.to)) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "date range end must be after its start",
      });
    }
  });

export type IssueDateRangeQuery = z.infer<typeof IssueDateRangeQuerySchema>;

export type IssueDateRangeErrorCode =
  | "unsupported_field"
  | "from_required"
  | "from_invalid"
  | "to_required"
  | "to_invalid"
  | "from_after_to";

export interface IssueDateRangeValidation {
  valid: boolean;
  field: "unsupported_field" | null;
  from: "from_required" | "from_invalid" | null;
  to: "to_required" | "to_invalid" | null;
  order: "from_after_to" | null;
}

interface DateOnly {
  year: number;
  month: number;
  day: number;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ISO_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u;

function isValidDateBoundary(value: string): boolean {
  const datePart = value.slice(0, 10);
  if (!parseDateOnly(datePart)) return false;
  if (value.length === 10) return true;
  return ISO_INSTANT_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function parseDateOnly(value: string): DateOnly | null {
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(0);
  probe.setUTCHours(0, 0, 0, 0);
  probe.setUTCFullYear(year, month - 1, day);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function dateOnlyToIso(value: DateOnly): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function nextDateOnly(value: DateOnly): DateOnly {
  const probe = new Date(0);
  probe.setUTCHours(0, 0, 0, 0);
  probe.setUTCFullYear(value.year, value.month - 1, value.day + 1);
  return {
    year: probe.getUTCFullYear(),
    month: probe.getUTCMonth() + 1,
    day: probe.getUTCDate(),
  };
}

export function validateIssueDateRange(
  value: unknown,
  registry: Readonly<
    Record<string, IssueDateField>
  > = ISSUE_DATE_FIELD_REGISTRY,
): IssueDateRangeValidation {
  const parsed = IssueDateRangeSchema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      field: "unsupported_field",
      from: "from_invalid",
      to: "to_invalid",
      order: null,
    };
  }

  const { field, from, to } = parsed.data;
  const fromError =
    from.length === 0
      ? "from_required"
      : parseDateOnly(from)
        ? null
        : "from_invalid";
  const toError =
    to.length === 0 ? "to_required" : parseDateOnly(to) ? null : "to_invalid";
  const order =
    fromError === null && toError === null && from > to
      ? "from_after_to"
      : null;
  const fieldError = getIssueDateField(field, registry)
    ? null
    : "unsupported_field";
  return {
    valid:
      fieldError === null &&
      fromError === null &&
      toError === null &&
      order === null,
    field: fieldError,
    from: fromError,
    to: toError,
    order,
  };
}

/**
 * Return the query range for a selected calendar range. Timestamp boundaries
 * are computed at local midnight in `timeZone`, with the end made exclusive at
 * the following local midnight. Invalid or incomplete ranges return undefined
 * so callers can keep rendering an inline correction without filtering data.
 */
export function toIssueDateRangeQuery(
  range: IssueDateRange | undefined,
  timeZone = getIssueDateTimeZone(),
  registry: Readonly<
    Record<string, IssueDateField>
  > = ISSUE_DATE_FIELD_REGISTRY,
): IssueDateRangeQuery | undefined {
  if (!range) return undefined;
  const validation = validateIssueDateRange(range, registry);
  if (!validation.valid) return undefined;

  const definition = getIssueDateField(range.field, registry);
  const from = parseDateOnly(range.from);
  const to = parseDateOnly(range.to);
  if (!definition || !from || !to) return undefined;

  if (definition.storage === "date-only") {
    return {
      field: definition.id,
      from: range.from,
      to: dateOnlyToIso(nextDateOnly(to)),
    };
  }

  return {
    field: definition.id,
    from: new Date(zonedMidnight(from, timeZone)).toISOString(),
    to: new Date(zonedMidnight(nextDateOnly(to), timeZone)).toISOString(),
  };
}

export function getIssueDateTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Match a row against a user-selected range. Invalid ranges pass through: the
 * UI reports the correction and the server query omits the condition.
 */
export function matchesIssueDateRange(
  row: Record<string, unknown>,
  range: IssueDateRange | undefined,
  timeZone = getIssueDateTimeZone(),
  registry: Readonly<
    Record<string, IssueDateField>
  > = ISSUE_DATE_FIELD_REGISTRY,
): boolean {
  return createIssueDateRangeMatcher(range, timeZone, registry)(row);
}

/**
 * Build a reusable membership predicate so a list pass normalizes its range
 * once instead of once per issue row.
 */
export function createIssueDateRangeMatcher(
  range: IssueDateRange | undefined,
  timeZone = getIssueDateTimeZone(),
  registry: Readonly<
    Record<string, IssueDateField>
  > = ISSUE_DATE_FIELD_REGISTRY,
): (row: Record<string, unknown>) => boolean {
  const query = toIssueDateRangeQuery(range, timeZone, registry);
  if (!query) return () => true;
  const definition = getIssueDateField(query.field, registry);
  if (!definition) return () => true;
  const from = Date.parse(query.from);
  const to = Date.parse(query.to);
  return (row) => {
    const value = row[definition.column];
    if (value == null) return false;

    if (definition.storage === "date-only") {
      const date = String(value).slice(0, 10);
      return date >= query.from && date < query.to;
    }

    const timestamp =
      value instanceof Date ? value.getTime() : Date.parse(String(value));
    return (
      !Number.isNaN(timestamp) &&
      !Number.isNaN(from) &&
      !Number.isNaN(to) &&
      timestamp >= from &&
      timestamp < to
    );
  };
}

function zonedMidnight(date: DateOnly, timeZone: string): number {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = datePartsInTimeZone(instant, timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const targetAsUtc = Date.UTC(date.year, date.month - 1, date.day);
    const delta = targetAsUtc - actualAsUtc;
    if (delta === 0) return instant;
    instant += delta;
  }
  return instant;
}

function datePartsInTimeZone(
  instant: number,
  timeZone: string,
): DateOnly & { hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  ) as Record<string, number>;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}
