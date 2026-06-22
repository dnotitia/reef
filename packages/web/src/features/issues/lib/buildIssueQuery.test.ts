// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { IssueFilter } from "../stores/useIssueStore";
import { buildIssueQuery, normalizeIssueQuery } from "./buildIssueQuery";

// Sort is consistently present now (REEF-057): an unset sort falls back to priority
// desc, applied at this query-building layer just (not the filter store / URL).
const DEFAULT_SORT = { sort_field: "priority", sort_order: "desc" } as const;

describe("buildIssueQuery", () => {
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
    // an empty string, so blanks must be filtered before the wire query.
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
