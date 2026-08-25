import { describe, expect, it } from "vitest";
import {
  defaultIssueGroupBy,
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

  it("round-trips all supported values without a compatibility alias", () => {
    for (const value of [
      "none",
      "status",
      "assignee",
      "priority",
      "sprint",
      "label",
    ] as const) {
      expect(
        parseIssueGroupBy(serializeIssueGroupBy(value), "active", "list"),
      ).toBe(value);
    }
  });
});
