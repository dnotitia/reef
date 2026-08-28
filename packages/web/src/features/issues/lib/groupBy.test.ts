import { describe, expect, it } from "vitest";
import {
  defaultIssueGroupBy,
  issueGroupByOptions,
  normalizeIssueGroupByParam,
  parseIssueGroupBy,
  serializeIssueGroupBy,
} from "./groupBy";

describe("issue group URL codec", () => {
  it("uses the view-specific defaults", () => {
    expect(defaultIssueGroupBy("active", "board")).toBe("status");
    expect(defaultIssueGroupBy("active", "list")).toBe("none");
    expect(defaultIssueGroupBy("active", "timeline")).toBe("none");
    expect(defaultIssueGroupBy("backlog", "board")).toBe("priority");
    expect(defaultIssueGroupBy("backlog", "list")).toBe("priority");
  });

  it("offers Epic grouping only on active Board and List", () => {
    expect(issueGroupByOptions("active", "board")).toContain("epic");
    expect(issueGroupByOptions("active", "list")).toContain("epic");
    expect(issueGroupByOptions("backlog", "board")).not.toContain("epic");
    expect(issueGroupByOptions("backlog", "list")).not.toContain("epic");
  });

  it("normalizes invalid and Board none values to the view default", () => {
    expect(parseIssueGroupBy("priority", "active", "board")).toBe("priority");
    expect(parseIssueGroupBy("none", "active", "board")).toBe("status");
    expect(parseIssueGroupBy("invalid", "active", "board")).toBe("status");
    expect(parseIssueGroupBy("invalid", "active", "list")).toBe("none");
    expect(parseIssueGroupBy("label", "active", "timeline")).toBe("none");
    expect(parseIssueGroupBy("status", "backlog", "board")).toBe("priority");
    expect(normalizeIssueGroupByParam("invalid", "active", "board")).toBe(
      "status",
    );
  });

  it("normalizes Epic to the existing defaults outside Active Board/List", () => {
    expect(parseIssueGroupBy("epic", "active", "board")).toBe("epic");
    expect(parseIssueGroupBy("epic", "active", "list")).toBe("epic");
    expect(parseIssueGroupBy("epic", "active", "timeline")).toBe("none");
    expect(parseIssueGroupBy("epic", "backlog", "board")).toBe("priority");
    expect(parseIssueGroupBy("epic", "backlog", "list")).toBe("priority");
  });

  it("round-trips all supported values without a compatibility alias", () => {
    for (const value of [
      "none",
      "status",
      "assignee",
      "priority",
      "sprint",
      "label",
      "epic",
    ] as const) {
      expect(
        parseIssueGroupBy(serializeIssueGroupBy(value), "active", "list"),
      ).toBe(value);
    }
  });
});
