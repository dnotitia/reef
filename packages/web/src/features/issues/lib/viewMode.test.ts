import { describe, expect, it } from "vitest";
import {
  normalizeIssueViewState,
  parseIssueViewState,
  parseScopeParam,
  parseViewParam,
} from "./viewMode";

describe("issue scope and layout URL codec", () => {
  it("keeps scope and layout as independent values", () => {
    expect(
      parseIssueViewState(new URLSearchParams("scope=backlog&view=list")),
    ).toEqual({
      scope: "backlog",
      layout: "list",
    });
  });

  it("does not interpret the retired mixed backlog view as a scope", () => {
    expect(parseScopeParam("backlog")).toBe("backlog");
    expect(parseViewParam("backlog")).toBe("board");
    expect(parseIssueViewState(new URLSearchParams("view=backlog"))).toEqual({
      scope: "active",
      layout: "board",
    });
  });

  it("normalizes the unsupported backlog timeline combination to list", () => {
    expect(normalizeIssueViewState("backlog", "timeline")).toEqual({
      scope: "backlog",
      layout: "list",
    });
  });
});
