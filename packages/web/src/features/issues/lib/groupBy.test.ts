import { describe, expect, it } from "vitest";
import {
  defaultIssueGroupBy,
  normalizeIssueGroupByParam,
  parseIssueGroupBy,
  serializeIssueGroupBy,
} from "./groupBy";

describe("issue group URL codec", () => {
  it("uses the view-specific defaults", () => {
    expect(defaultIssueGroupBy("board")).toBe("status");
    expect(defaultIssueGroupBy("list")).toBe("none");
    expect(defaultIssueGroupBy("timeline")).toBe("none");
    expect(defaultIssueGroupBy("backlog")).toBe("none");
  });

  it("normalizes invalid and Board none values to the view default", () => {
    expect(parseIssueGroupBy("priority", "board")).toBe("priority");
    expect(parseIssueGroupBy("none", "board")).toBe("status");
    expect(parseIssueGroupBy("invalid", "board")).toBe("status");
    expect(parseIssueGroupBy("invalid", "list")).toBe("none");
    expect(parseIssueGroupBy("label", "timeline")).toBe("none");
    expect(normalizeIssueGroupByParam("invalid", "board")).toBe("status");
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
      expect(parseIssueGroupBy(serializeIssueGroupBy(value), "list")).toBe(
        value,
      );
    }
  });
});
