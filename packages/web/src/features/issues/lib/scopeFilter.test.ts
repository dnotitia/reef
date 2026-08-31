import { describe, expect, it } from "vitest";
import { buildIssueQuery } from "./buildIssueQuery";
import { filterForIssueScope, hasScopeFilters } from "./scopeFilter";

describe("issue scope projection", () => {
  it("limits Active queries to workflow statuses", () => {
    expect(buildIssueQuery({}, "", "active").status).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "done",
      "closed",
    ]);
  });

  it("pins Backlog queries and neutralizes hidden facets", () => {
    const projected = filterForIssueScope(
      {
        status: ["done"],
        sprint_id: ["sprint-1"],
        release_id: ["release-1"],
        due: ["overdue"],
        showStale: true,
      },
      "backlog",
    );
    expect(projected).toMatchObject({ status: ["backlog"] });
    expect(projected.sprint_id).toBeUndefined();
    expect(projected.release_id).toBeUndefined();
    expect(projected.due).toBeUndefined();
    expect(projected.showStale).toBeUndefined();
    expect(buildIssueQuery(projected, "", "backlog").status).toEqual([
      "backlog",
    ]);
  });

  it("does not count a scope's pinned status as a filter", () => {
    expect(hasScopeFilters({}, "", "backlog")).toBe(false);
    expect(hasScopeFilters({ priority: ["high"] }, "", "backlog")).toBe(true);
    expect(
      hasScopeFilters(
        { priorityUnset: true, severityUnset: true, assigneeUnset: true },
        "",
        "backlog",
      ),
    ).toBe(true);
  });
});
