// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildNavigationHref,
  buildViewHref,
  resolveCurrentIssueView,
} from "./commandNavigation";

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
      "/workspace/reef-acme/issues?assignee=alice&q=launch&sort=priority&view=list&scope=active",
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
    ).toBe("/workspace/reef-acme/issues?scope=active&view=timeline");
  });

  it("resolves the active issue view only inside the issues workspace", () => {
    expect(
      resolveCurrentIssueView({
        pathname: "/workspace/reef-acme/issues",
        search: "",
      }),
    ).toBe("board");
    expect(
      resolveCurrentIssueView({
        pathname: "/workspace/reef-acme/issues",
        search: "?view=list",
      }),
    ).toBe("list");
    expect(
      resolveCurrentIssueView({
        pathname: "/workspace/reef-acme/planning",
        search: "?view=timeline",
      }),
    ).toBeNull();
  });
});
