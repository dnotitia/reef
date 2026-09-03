import { describe, expect, it } from "vitest";
import {
  ISSUE_DATE_FIELD_REGISTRY,
  IssueDateRangeQuerySchema,
  getIssueDateField,
  matchesIssueDateRange,
  toIssueDateRangeQuery,
  validateIssueDateRange,
} from "./dateRange";

const updatedRange = {
  field: "updated_at",
  from: "2026-06-01",
  to: "2026-06-02",
};

describe("issue date range module", () => {
  it("registers the supported timestamp and date-only issue fields", () => {
    expect(getIssueDateField("updated_at")).toMatchObject({
      id: "updated_at",
      storage: "timestamp",
      nullable: false,
      column: "updated_at",
    });
    expect(getIssueDateField("created_at")).toMatchObject({
      id: "created_at",
      storage: "timestamp",
      nullable: false,
      column: "created_at",
    });
    expect(getIssueDateField("start_date")).toMatchObject({
      id: "start_date",
      storage: "date-only",
      nullable: true,
      column: "start_date",
    });
    expect(getIssueDateField("due_date")).toMatchObject({
      id: "due_date",
      storage: "date-only",
      nullable: true,
      column: "due_date",
    });
    expect(Object.keys(ISSUE_DATE_FIELD_REGISTRY)).toEqual([
      "updated_at",
      "created_at",
      "start_date",
      "due_date",
    ]);
  });

  it("reports incomplete and reversed calendar ranges without applying them", () => {
    expect(
      validateIssueDateRange({
        field: "updated_at",
        from: "2026-06-01",
        to: "",
      }),
    ).toMatchObject({ valid: false, to: "to_required" });
    expect(
      validateIssueDateRange({
        field: "updated_at",
        from: "2026-06-03",
        to: "2026-06-02",
      }),
    ).toMatchObject({ valid: false, order: "from_after_to" });
    expect(
      toIssueDateRangeQuery({
        field: "updated_at",
        from: "2026-06-01",
        to: "",
      }),
    ).toBeUndefined();
  });

  it("normalizes timestamp boundaries to browser-local midnights", () => {
    expect(toIssueDateRangeQuery(updatedRange, "America/Los_Angeles")).toEqual({
      field: "updated_at",
      from: "2026-06-01T07:00:00.000Z",
      to: "2026-06-03T07:00:00.000Z",
    });
    expect(
      toIssueDateRangeQuery(
        { field: "created_at", from: "2026-06-01", to: "2026-06-02" },
        "America/Los_Angeles",
      ),
    ).toEqual({
      field: "created_at",
      from: "2026-06-01T07:00:00.000Z",
      to: "2026-06-03T07:00:00.000Z",
    });
  });

  it("keeps date-only boundaries as stored calendar days in every timezone", () => {
    const range = { field: "start_date", from: "2026-06-01", to: "2026-06-02" };
    expect(toIssueDateRangeQuery(range, "America/Los_Angeles")).toEqual({
      field: "start_date",
      from: "2026-06-01",
      to: "2026-06-03",
    });
    expect(
      toIssueDateRangeQuery({ ...range, field: "due_date" }, "Asia/Seoul"),
    ).toEqual({
      field: "due_date",
      from: "2026-06-01",
      to: "2026-06-03",
    });
  });

  it("matches nullable date-only fields while excluding unset rows", () => {
    const range = { field: "due_date", from: "2026-06-01", to: "2026-06-02" };
    expect(
      matchesIssueDateRange({ due_date: "2026-05-31" }, range, "UTC"),
    ).toBe(false);
    expect(
      matchesIssueDateRange({ due_date: "2026-06-01" }, range, "UTC"),
    ).toBe(true);
    expect(matchesIssueDateRange({ due_date: null }, range, "UTC")).toBe(false);
    expect(matchesIssueDateRange({}, range, "UTC")).toBe(false);
  });

  it("starts at the first valid instant when local midnight is skipped", () => {
    expect(
      toIssueDateRangeQuery(
        { field: "updated_at", from: "2026-03-08", to: "2026-03-08" },
        "America/Havana",
      ),
    ).toEqual({
      field: "updated_at",
      from: "2026-03-08T05:00:00.000Z",
      to: "2026-03-09T04:00:00.000Z",
    });
  });

  it("includes both boundary instants and excludes the next local day", () => {
    const range = { field: "updated_at", from: "2026-06-01", to: "2026-06-02" };
    const zone = "America/Los_Angeles";
    expect(
      matchesIssueDateRange(
        { updated_at: "2026-06-01T06:59:59.999Z" },
        range,
        zone,
      ),
    ).toBe(false);
    expect(
      matchesIssueDateRange(
        { updated_at: "2026-06-01T07:00:00.000Z" },
        range,
        zone,
      ),
    ).toBe(true);
    expect(
      matchesIssueDateRange(
        { updated_at: "2026-06-03T06:59:59.999Z" },
        range,
        zone,
      ),
    ).toBe(true);
    expect(
      matchesIssueDateRange(
        { updated_at: "2026-06-03T07:00:00.000Z" },
        range,
        zone,
      ),
    ).toBe(false);
  });

  it("keeps the range value shape when another registry field is added", () => {
    const registry = {
      ...ISSUE_DATE_FIELD_REGISTRY,
      created_at: {
        id: "created_at",
        label: "Created",
        storage: "timestamp" as const,
        nullable: false,
        column: "created_at",
      },
    };
    const range = { field: "created_at", from: "2026-06-01", to: "2026-06-01" };
    expect(validateIssueDateRange(range, registry).valid).toBe(true);
    expect(toIssueDateRangeQuery(range, "UTC", registry)).toEqual({
      field: "created_at",
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-02T00:00:00.000Z",
    });
    expect(
      matchesIssueDateRange(
        { created_at: "2026-06-01T12:00:00.000Z" },
        range,
        "UTC",
        registry,
      ),
    ).toBe(true);
  });

  it("rejects an unregistered field at the query boundary", () => {
    expect(
      IssueDateRangeQuerySchema.safeParse({
        field: "custom_date",
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-06-02T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts normalized ranges for every registered field", () => {
    expect(
      IssueDateRangeQuerySchema.parse({
        field: "created_at",
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-06-02T00:00:00.000Z",
      }),
    ).toMatchObject({ field: "created_at" });
    expect(
      IssueDateRangeQuerySchema.parse({
        field: "start_date",
        from: "2026-06-01",
        to: "2026-06-02",
      }),
    ).toEqual({ field: "start_date", from: "2026-06-01", to: "2026-06-02" });
    expect(
      IssueDateRangeQuerySchema.parse({
        field: "due_date",
        from: "2026-06-01",
        to: "2026-06-02",
      }),
    ).toMatchObject({ field: "due_date" });
  });

  it("rejects a storage boundary that does not match the registered semantics", () => {
    expect(
      IssueDateRangeQuerySchema.safeParse({
        field: "created_at",
        from: "2026-06-01",
        to: "2026-06-02",
      }).success,
    ).toBe(false);
    expect(
      IssueDateRangeQuerySchema.safeParse({
        field: "start_date",
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-06-02T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
