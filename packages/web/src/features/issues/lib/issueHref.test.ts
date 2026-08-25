// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildOpenIssueHref } from "./issueHref";

describe("buildOpenIssueHref", () => {
  it("carries ?view= so the backdrop keeps the originating tab (REEF-222)", () => {
    const query = new URLSearchParams({ scope: "backlog", view: "list" });
    expect(buildOpenIssueHref("reef-acme", "REEF-222", query)).toBe(
      "/workspace/reef-acme/issues/REEF-222?scope=backlog&view=list",
    );
  });

  it("preserves filter/sort params alongside view, like ViewSwitcher", () => {
    const query = new URLSearchParams(
      "view=list&status=in_progress&sort=priority",
    );
    expect(buildOpenIssueHref("reef-acme", "REEF-1", query)).toBe(
      "/workspace/reef-acme/issues/REEF-1?view=list&status=in_progress&sort=priority",
    );
  });

  it("emits a bare vault-scoped path with no params so the hard-nav deep link is unchanged", () => {
    expect(
      buildOpenIssueHref("reef-acme", "REEF-9", new URLSearchParams()),
    ).toBe("/workspace/reef-acme/issues/REEF-9");
  });

  it("sends an unresolved vault to onboarding", () => {
    expect(buildOpenIssueHref("", "REEF-9", new URLSearchParams())).toBe(
      "/onboarding",
    );
  });
});
