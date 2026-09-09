// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readPlanningView } from "../components/planningPageUtils";

describe("readPlanningView", () => {
  it("uses Overview for the default route and explicit overview state", () => {
    expect(readPlanningView(new URLSearchParams())).toBe("overview");
    expect(readPlanningView(new URLSearchParams("view=overview"))).toBe(
      "overview",
    );
  });

  it("restores List for the explicit view and legacy kind/detail links", () => {
    expect(readPlanningView(new URLSearchParams("view=list"))).toBe("list");
    expect(readPlanningView(new URLSearchParams("kind=milestones"))).toBe(
      "list",
    );
    expect(readPlanningView(new URLSearchParams("detail=milestone-1"))).toBe(
      "list",
    );
  });

  it("lets an explicit view resolve an otherwise stale kind parameter", () => {
    expect(
      readPlanningView(new URLSearchParams("view=overview&kind=releases")),
    ).toBe("overview");
  });
});
