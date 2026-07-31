// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  resolveCommandTarget,
  resolveIssueKeyboardScope,
} from "./commandContext";

const issues = new Map([
  ["REEF-001", { id: "REEF-001", title: "Detail issue" }],
  ["REEF-002", { id: "REEF-002", title: "Focused issue" }],
]);

describe("command context", () => {
  it("prefers the detail issue over a focused list or board issue", () => {
    expect(
      resolveCommandTarget({
        pathname: "/workspace/reef-acme/issues/REEF-001",
        search: "?view=list",
        selectionActive: false,
        focusedIssueId: { list: "REEF-002", board: "REEF-002" },
        lookupIssue: (id) => issues.get(id),
      }),
    ).toEqual({
      issueId: "REEF-001",
      title: "Detail issue",
      source: "detail",
    });
  });

  it("uses the focused issue only in list or board view", () => {
    expect(
      resolveCommandTarget({
        pathname: "/workspace/reef-acme/issues",
        search: "?view=list",
        selectionActive: false,
        focusedIssueId: { list: "REEF-002", board: null },
        lookupIssue: (id) => issues.get(id),
      }),
    ).toEqual({
      issueId: "REEF-002",
      title: "Focused issue",
      source: "list",
    });
    expect(
      resolveIssueKeyboardScope(
        "/workspace/reef-acme/issues",
        "?view=timeline",
      ),
    ).toBeNull();
  });

  it("hides single-issue context during selection or without a target", () => {
    expect(
      resolveCommandTarget({
        pathname: "/workspace/reef-acme/issues",
        search: "?view=list",
        selectionActive: true,
        focusedIssueId: { list: "REEF-002", board: null },
        lookupIssue: (id) => issues.get(id),
      }),
    ).toBeNull();
    expect(
      resolveCommandTarget({
        pathname: "/workspace/reef-acme/reports",
        search: "",
        selectionActive: false,
        focusedIssueId: { list: "REEF-002", board: "REEF-002" },
        lookupIssue: (id) => issues.get(id),
      }),
    ).toBeNull();
  });
});
