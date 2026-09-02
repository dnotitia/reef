// @vitest-environment node

import { describe, expect, it } from "vitest";
import { toIssueDateRangeQuery } from "@reef/core";
import type { IssueFilter } from "../stores/useIssueStore";
import {
  buildIssueQuery,
  buildManualIssueQuery,
  normalizeIssueQuery,
} from "./buildIssueQuery";

// Sort is consistently present now (REEF-057): an unset sort falls back to priority
// desc, applied at this query-building layer just (not the filter store / URL).
const DEFAULT_SORT = { sort_field: "priority", sort_order: "desc" } as const;

describe("buildIssueQuery", () => {
  it("maps an explicitly selected Manual mode to rank order", () => {
    expect(buildIssueQuery({ orderingMode: "manual" })).toEqual({
      sort_field: "rank",
      sort_order: "asc",
    });
  });
  it("applies the default sort (priority desc) for an empty filter", () => {
    expect(buildIssueQuery({})).toEqual({ ...DEFAULT_SORT });
  });

  it("maps valid facets to the snake_case wire query", () => {
    expect(buildIssueQuery({ status: ["todo"], assignee: ["alice"] })).toEqual({
      status: ["todo"],
      assigned_to: ["alice"],
      ...DEFAULT_SORT,
    });
  });

  it("normalizes a complete updated-at calendar range for the server", () => {
    const dateRange = {
      field: "updated_at",
      from: "2026-06-01",
      to: "2026-06-02",
    };
    const normalized = toIssueDateRangeQuery(dateRange);
    expect(
      buildIssueQuery({
        dateRange,
      }),
    ).toMatchObject({
      date_field: normalized?.field,
      date_from: normalized?.from,
      date_to: normalized?.to,
      ...DEFAULT_SORT,
    });
  });

  it.each(["created_at", "start_date", "due_date"] as const)(
    "normalizes a complete %s range for the server",
    (field) => {
      const normalized = toIssueDateRangeQuery({
        field,
        from: "2026-06-01",
        to: "2026-06-01",
      });
      expect(
        buildIssueQuery({
          dateRange: { field, from: "2026-06-01", to: "2026-06-01" },
        }),
      ).toMatchObject({
        date_field: field,
        date_from: normalized?.from,
        date_to: normalized?.to,
        ...DEFAULT_SORT,
      });
    },
  );

  it("omits an incomplete date range instead of narrowing the query", () => {
    expect(
      buildIssueQuery({
        dateRange: { field: "updated_at", from: "2026-06-01", to: "" },
      }),
    ).toEqual({ ...DEFAULT_SORT });
  });

  it("keeps the complete rank spine for Manual date filtering", () => {
    expect(
      buildIssueQuery({
        orderingMode: "manual",
        dateRange: {
          field: "updated_at",
          from: "2026-06-01",
          to: "2026-06-02",
        },
      }),
    ).toEqual({ sort_field: "rank", sort_order: "asc" });
  });

  it("maps unset filter flags separately from real values", () => {
    expect(
      buildIssueQuery({
        priority: ["high"],
        priorityUnset: true,
        severityUnset: true,
        assignee: ["__none__"],
        assigneeUnset: true,
      }),
    ).toEqual({
      priority: ["high"],
      priority_unset: "true",
      severity_unset: "true",
      assigned_to: ["__none__"],
      assigned_to_unset: "true",
      ...DEFAULT_SORT,
    });
  });

  it("uses the server absence predicate only for a pure no-due selection", () => {
    expect(buildIssueQuery({ due: ["no_due"] })).toMatchObject({
      due_unset: "true",
    });
    expect(buildIssueQuery({ due: ["no_due", "overdue"] })).not.toHaveProperty(
      "due_unset",
    );
  });

  it("maps multi-value people/planning facets to repeated wire arrays (REEF-267)", () => {
    expect(
      buildIssueQuery({
        assignee: ["alice", "bob"],
        requester: ["carol"],
        sprint_id: ["s1", "s2"],
        release_id: ["r1"],
      }),
    ).toEqual({
      assigned_to: ["alice", "bob"],
      requester: ["carol"],
      sprint_id: ["s1", "s2"],
      release_id: ["r1"],
      ...DEFAULT_SORT,
    });
  });

  it("omits an empty people/planning facet array", () => {
    expect(buildIssueQuery({ assignee: [], sprint_id: [] })).toEqual({
      ...DEFAULT_SORT,
    });
  });

  it("drops blank members so a stale `?assignee=` does not 400 the list (REEF-267)", () => {
    // A hand-edited/stale URL reads as `[""]`; the strict server schema rejects
    // an empty string, so blanks should be filtered before the wire query.
    expect(buildIssueQuery({ assignee: [""], sprint_id: ["", " "] })).toEqual({
      ...DEFAULT_SORT,
    });
    // Mixed valid + blank keeps the valid members.
    expect(
      buildIssueQuery({ assignee: ["alice", ""], release_id: [" ", "r1"] }),
    ).toEqual({
      assigned_to: ["alice"],
      release_id: ["r1"],
      ...DEFAULT_SORT,
    });
  });

  it("keeps the valid members of a multi-select facet (REEF-031)", () => {
    expect(buildIssueQuery({ status: ["todo", "in_progress"] })).toEqual({
      status: ["todo", "in_progress"],
      ...DEFAULT_SORT,
    });
  });

  it("drops enum facets carrying unsupported (stale-URL) values", () => {
    // A stale/shared URL can put an unknown enum member in the store; sending it
    // to the strict server schema would 400. It should be dropped instead — just
    // the default sort remains.
    expect(buildIssueQuery({ status: ["blocked"] })).toEqual({
      ...DEFAULT_SORT,
    });
    // Mixed valid + invalid members keep the valid ones.
    expect(buildIssueQuery({ priority: ["nope"], status: ["todo"] })).toEqual({
      status: ["todo"],
      ...DEFAULT_SORT,
    });
  });

  it("falls back to the default sort for an unsupported (stale-URL) sort field", () => {
    expect(
      buildIssueQuery({ sortField: "bogus" as IssueFilter["sortField"] }),
    ).toEqual({ ...DEFAULT_SORT });
  });

  it("passes through an explicit user-selected sort", () => {
    expect(
      buildIssueQuery({ sortField: "due_date", sortOrder: "asc" }),
    ).toEqual({ sort_field: "due_date", sort_order: "asc" });
  });

  it("passes through ticket-number sorting in either direction", () => {
    expect(buildIssueQuery({ sortField: "reef_id", sortOrder: "asc" })).toEqual(
      { sort_field: "reef_id", sort_order: "asc" },
    );
    expect(
      buildIssueQuery({ sortField: "reef_id", sortOrder: "desc" }),
    ).toEqual({ sort_field: "reef_id", sort_order: "desc" });
  });

  it("ignores an orphaned sort order when no valid field is selected", () => {
    // A stale/shared URL or a persisted filter can leave `sortOrder` set with no
    // (or a dropped) field. The order should not flip the default priority desc —
    // otherwise the board silently shows low-priority issues first.
    expect(buildIssueQuery({ sortOrder: "asc" })).toEqual({ ...DEFAULT_SORT });
    expect(
      buildIssueQuery({
        sortField: "bogus" as IssueFilter["sortField"],
        sortOrder: "asc",
      }),
    ).toEqual({ ...DEFAULT_SORT });
  });

  it("maps a non-empty search query to the trimmed `q` facet (REEF-034)", () => {
    expect(buildIssueQuery({}, "  auth flow  ")).toEqual({
      q: "auth flow",
      ...DEFAULT_SORT,
    });
  });

  it("AND-combines `q` with explicit facets", () => {
    expect(buildIssueQuery({ status: ["todo"] }, "auth")).toEqual({
      status: ["todo"],
      q: "auth",
      ...DEFAULT_SORT,
    });
  });

  it("omits `q` for an empty or whitespace-only search (default sort only)", () => {
    expect(buildIssueQuery({})).toEqual({ ...DEFAULT_SORT });
    expect(buildIssueQuery({}, "")).toEqual({ ...DEFAULT_SORT });
    expect(buildIssueQuery({}, "   ")).toEqual({ ...DEFAULT_SORT });
  });
});

describe("buildManualIssueQuery", () => {
  it("fetches the complete active ordering spine and keeps residual filters client-side", () => {
    expect(
      buildManualIssueQuery(
        { priority: ["high"], showArchived: false },
        "active",
      ),
    ).toEqual({
      status: ["todo", "in_progress", "in_review", "done", "closed"],
      sort_field: "rank",
      sort_order: "asc",
    });
  });

  it("pins the Manual ordering spine to backlog when requested", () => {
    expect(buildManualIssueQuery({ showArchived: true }, "backlog")).toEqual({
      status: ["backlog"],
      archived: "true",
      sort_field: "rank",
      sort_order: "asc",
    });
  });
});

describe("normalizeIssueQuery", () => {
  it("sorts array values for a stable key", () => {
    expect(normalizeIssueQuery({ status: ["in_progress", "todo"] })).toEqual(
      normalizeIssueQuery({ status: ["todo", "in_progress"] }),
    );
  });

  it("does not collide when a free-text value contains & or =", () => {
    // A flattened `key=value&...` string would make these equal; the structured
    // object key should keep them distinct.
    expect(
      normalizeIssueQuery({ assigned_to: "alice&requester=bob" }),
    ).not.toEqual(
      normalizeIssueQuery({ assigned_to: "alice", requester: "bob" }),
    );
  });
});
