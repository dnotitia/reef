// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildOpenIssueHref } from "./issueHref";

describe("buildOpenIssueHref", () => {
  it("carries ?view= so the backdrop keeps the originating tab (REEF-222)", () => {
    const query = new URLSearchParams({ view: "backlog" });
    expect(buildOpenIssueHref("REEF-222", query)).toBe(
      "/issues/REEF-222?view=backlog",
    );
  });

  it("preserves filter/sort params alongside view, like ViewSwitcher", () => {
    const query = new URLSearchParams(
      "view=list&status=in_progress&sort=priority",
    );
    expect(buildOpenIssueHref("REEF-1", query)).toBe(
      "/issues/REEF-1?view=list&status=in_progress&sort=priority",
    );
  });

  it("emits a bare path with no params so the hard-nav deep link is unchanged", () => {
    expect(buildOpenIssueHref("REEF-9", new URLSearchParams())).toBe(
      "/issues/REEF-9",
    );
  });
});
