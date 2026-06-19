import { describe, expect, it } from "vitest";
import { pmModelContent } from "./pmModel";

/**
 * Contract regression for the PM data-model manifest (REEF-252). issue-workflows.md
 * instructs agents to INSERT into reef_activity and comments-and-activity.md to
 * read/write reef_comments, so both tables need entries in the data-model manifest
 * — otherwise an agent told to use a table absent from pm-model.md hits a
 * documented-vs-reality gap. These assertions pin that the manifest lists both
 * tables and their columns.
 */
describe("pm-model data-model manifest (REEF-252)", () => {
  const content = pmModelContent("reef-test");

  it("lists reef_comments and reef_activity in Core tables", () => {
    expect(content).toContain("- reef_comments: per-issue discussion thread");
    expect(content).toContain(
      "- reef_activity: per-issue immutable activity/audit log",
    );
  });

  it("documents reef_comments columns including the meta shape", () => {
    expect(content).toContain("## reef_comments columns");
    expect(content).toContain("{author, created_at, edited_at}");
  });

  it("documents reef_activity columns including event_type and the meta shape", () => {
    expect(content).toContain("## reef_activity columns");
    expect(content).toContain(
      "status_change, assignee_change, priority_change, planning_link, or impl_ref_linked",
    );
    expect(content).toContain("{actor, at, source}");
  });

  it("keeps the canonical author/timestamps in meta, not akb's auto columns", () => {
    expect(content).toContain(
      "the author and timestamps live in meta -- NOT in akb's auto created_by/created_at columns",
    );
  });
});
