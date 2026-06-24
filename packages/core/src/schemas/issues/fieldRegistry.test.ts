import { describe, expect, it } from "vitest";
import {
  CLOSED_REASON_OPTIONS,
  FIELD_NAME_KEYS,
  ISSUE_FIELD_MESSAGES_EN,
  ISSUE_TYPE_OPTIONS,
  NO_SELECTION,
  PRIORITY_OPTIONS,
  SEVERITY_OPTIONS,
  STATUS_OPTIONS,
  WORKFLOW_STATUS_OPTIONS,
  naturalSortOrder,
} from "./fieldRegistry";
import {
  ClosedReasonEnum,
  IssueTypeEnum,
  PriorityEnum,
  SeverityEnum,
  StatusEnum,
} from "./metadata";
import { USER_SORT_FIELDS } from "./requests";

describe("fieldRegistry", () => {
  it("keeps the canonical no-selection sentinel value stable", () => {
    // Consolidated from the former NO_PRIORITY / NO_SELECTION constants.
    expect(NO_SELECTION).toBe("__none__");
  });

  describe("backlog status (REEF-109)", () => {
    it("labels open as 'Todo' and adds a 'Backlog' label", () => {
      // The `open` enum key is unchanged; just its display label became "Todo".
      expect(ISSUE_FIELD_MESSAGES_EN.status.todo).toBe("Todo");
      expect(ISSUE_FIELD_MESSAGES_EN.status.backlog).toBe("Backlog");
    });

    it("derives WORKFLOW_STATUS_OPTIONS as STATUS_OPTIONS minus backlog", () => {
      expect(STATUS_OPTIONS).toContain("backlog");
      expect(WORKFLOW_STATUS_OPTIONS).not.toContain("backlog");
      expect([...WORKFLOW_STATUS_OPTIONS]).toEqual(
        STATUS_OPTIONS.filter((s) => s !== "backlog"),
      );
    });
  });

  // The enum value is the i18n message key (REEF-292): the en base catalog must
  // carry exactly one non-empty label per enum member so a locale lookup never
  // hits a hole, and the option array must mirror the schema enum order.
  const cases = [
    {
      name: "status",
      values: StatusEnum.options,
      options: STATUS_OPTIONS,
      labels: ISSUE_FIELD_MESSAGES_EN.status,
    },
    {
      name: "priority",
      values: PriorityEnum.options,
      options: PRIORITY_OPTIONS,
      labels: ISSUE_FIELD_MESSAGES_EN.priority,
    },
    {
      name: "issue_type",
      values: IssueTypeEnum.options,
      options: ISSUE_TYPE_OPTIONS,
      labels: ISSUE_FIELD_MESSAGES_EN.issueType,
    },
    {
      name: "severity",
      values: SeverityEnum.options,
      options: SEVERITY_OPTIONS,
      labels: ISSUE_FIELD_MESSAGES_EN.severity,
    },
    {
      name: "closed_reason",
      values: ClosedReasonEnum.options,
      options: CLOSED_REASON_OPTIONS,
      labels: ISSUE_FIELD_MESSAGES_EN.closedReason,
    },
  ] as const;

  for (const { name, values, options, labels } of cases) {
    describe(name, () => {
      it("option array matches the schema enum exactly (order included)", () => {
        expect([...options]).toEqual([...values]);
      });

      it("has a non-empty label for every enum member and no extras", () => {
        expect(Object.keys(labels).sort()).toEqual([...values].sort());
        for (const value of values) {
          expect(
            (labels as Record<string, string>)[value]?.length,
          ).toBeGreaterThan(0);
        }
      });
    });
  }

  describe("field-name labels (REEF-301)", () => {
    it("has a non-empty label for every field-name key and no extras", () => {
      expect(Object.keys(ISSUE_FIELD_MESSAGES_EN.name).sort()).toEqual(
        [...FIELD_NAME_KEYS].sort(),
      );
      for (const key of FIELD_NAME_KEYS) {
        expect(ISSUE_FIELD_MESSAGES_EN.name[key].length).toBeGreaterThan(0);
      }
    });
  });

  it("has a hint for every closed reason", () => {
    expect(
      Object.keys(ISSUE_FIELD_MESSAGES_EN.closedReasonHint).sort(),
    ).toEqual([...ClosedReasonEnum.options].sort());
  });

  describe("sort metadata (REEF-059)", () => {
    it("has a non-empty label for every user sort field and no extras", () => {
      expect(Object.keys(ISSUE_FIELD_MESSAGES_EN.sortField).sort()).toEqual(
        [...USER_SORT_FIELDS].sort(),
      );
      for (const field of USER_SORT_FIELDS) {
        expect(ISSUE_FIELD_MESSAGES_EN.sortField[field].length).toBeGreaterThan(
          0,
        );
      }
    });

    it("has a distinct, non-empty direction label per order for every field", () => {
      expect(Object.keys(ISSUE_FIELD_MESSAGES_EN.sortDirection).sort()).toEqual(
        [...USER_SORT_FIELDS].sort(),
      );
      for (const field of USER_SORT_FIELDS) {
        const { asc, desc } = ISSUE_FIELD_MESSAGES_EN.sortDirection[field];
        expect(asc.length).toBeGreaterThan(0);
        expect(desc.length).toBeGreaterThan(0);
        expect(asc).not.toBe(desc);
      }
    });

    it("reads direction labels as the user's intent", () => {
      expect(ISSUE_FIELD_MESSAGES_EN.sortDirection.priority.desc).toBe(
        "High → Low",
      );
      expect(ISSUE_FIELD_MESSAGES_EN.sortDirection.due_date.asc).toBe(
        "Soonest",
      );
      expect(ISSUE_FIELD_MESSAGES_EN.sortDirection.title.asc).toBe("A → Z");
      expect(ISSUE_FIELD_MESSAGES_EN.sortDirection.estimate_points.desc).toBe(
        "Most",
      );
    });

    it("picks a forward-reading natural order for dates and titles, strongest-first otherwise", () => {
      expect(naturalSortOrder("due_date")).toBe("asc");
      expect(naturalSortOrder("start_date")).toBe("asc");
      expect(naturalSortOrder("title")).toBe("asc");
      expect(naturalSortOrder("priority")).toBe("desc");
      expect(naturalSortOrder("created_at")).toBe("desc");
      expect(naturalSortOrder("updated_at")).toBe("desc");
      expect(naturalSortOrder("estimate_points")).toBe("desc");
    });
  });
});
