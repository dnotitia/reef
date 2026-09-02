import { describe, expect, it } from "vitest";
import { applyMyViewSnapshot, buildMyViewSnapshot } from "./myViewSnapshot";
import { serializeMyViewSnapshot } from "@reef/core";

describe("My View workspace snapshot codec", () => {
  it("stores the complete workspace state without one-off search or selection", () => {
    const snapshot = buildMyViewSnapshot({
      filter: {
        status: ["todo"],
        priority: ["high"],
        priorityUnset: true,
        severityUnset: true,
        assigneeUnset: true,
        due: ["no_due"],
        dateRange: {
          field: "updated_at",
          from: "2026-06-01",
          to: "2026-06-02",
        },
        sortField: "updated_at",
        sortOrder: "desc",
        showArchived: true,
        search: "temporary",
      },
      scope: "active",
      layout: "list",
      groupBy: "label",
      listOptionalColumns: ["release", "start", "release"],
    });

    expect(snapshot).toEqual({
      filter: {
        status: ["todo"],
        priority: ["high"],
        priorityUnset: true,
        severityUnset: true,
        assigneeUnset: true,
        due: ["no_due"],
        dateRange: {
          field: "updated_at",
          from: "2026-06-01",
          to: "2026-06-02",
        },
      },
      scope: "active",
      layout: "list",
      grouping: "label",
      ordering: { mode: "field", field: "updated_at", direction: "desc" },
      display: { showArchived: true, listColumns: ["start", "release"] },
    });
    expect(JSON.stringify(snapshot)).not.toContain("temporary");
    expect(JSON.stringify(snapshot)).not.toContain("search");
  });

  it("keeps Manual mode mode-only and applies field ordering as a complete pair", () => {
    const manual = applyMyViewSnapshot({
      filter: { priority: ["high"] },
      scope: "active",
      layout: "board",
      grouping: "status",
      ordering: { mode: "manual" },
      display: {},
    });
    expect(manual.filter).toMatchObject({
      priority: ["high"],
      orderingMode: "manual",
    });
    expect(manual.filter.sortField).toBeUndefined();
    expect(manual.filter.sortOrder).toBeUndefined();
    expect(manual.listOptionalColumns).toEqual([]);

    const field = applyMyViewSnapshot({
      filter: {},
      scope: "active",
      layout: "list",
      grouping: "none",
      ordering: { mode: "field", field: "title", direction: "asc" },
      display: { listColumns: ["milestone"] },
    });
    expect(field.filter).toMatchObject({
      orderingMode: "field",
      sortField: "title",
      sortOrder: "asc",
    });
    expect(field.listOptionalColumns).toEqual(["milestone"]);
  });

  it("compares equivalent array ordering and implicit field direction canonically", () => {
    const left = serializeMyViewSnapshot(
      buildMyViewSnapshot({
        filter: { status: ["todo", "in_progress"], sortField: "due_date" },
        scope: "active",
        layout: "list",
        groupBy: "none",
        listOptionalColumns: ["release", "start"],
      }),
    );
    const right = serializeMyViewSnapshot(
      buildMyViewSnapshot({
        filter: {
          status: ["in_progress", "todo"],
          sortField: "due_date",
          sortOrder: "asc",
        },
        scope: "active",
        layout: "list",
        groupBy: "none",
        listOptionalColumns: ["start", "release"],
      }),
    );
    expect(left).toBe(right);
  });
});
