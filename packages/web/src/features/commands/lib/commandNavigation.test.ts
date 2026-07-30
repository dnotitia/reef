// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildNavigationHref, buildViewHref } from "./commandNavigation";

describe("command navigation", () => {
  it("always scopes navigation destinations to the active vault", () => {
    expect(buildNavigationHref("reef-acme", "/planning")).toBe(
      "/workspace/reef-acme/planning",
    );
  });

  it("preserves issue workspace filters, search, and sort while changing view", () => {
    expect(
      buildViewHref({
        vault: "reef-acme",
        pathname: "/workspace/reef-acme/issues",
        search: "?assignee=alice&q=launch&sort=priority&view=board",
        view: "list",
      }),
    ).toBe(
      "/workspace/reef-acme/issues?assignee=alice&q=launch&sort=priority&view=list",
    );
  });

  it("uses the canonical issues route outside the issue workspace", () => {
    expect(
      buildViewHref({
        vault: "reef-acme",
        pathname: "/workspace/reef-acme/reports",
        search: "?range=month",
        view: "timeline",
      }),
    ).toBe("/workspace/reef-acme/issues?view=timeline");
  });
});
