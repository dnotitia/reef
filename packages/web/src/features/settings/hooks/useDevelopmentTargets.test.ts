// @vitest-environment node
import { describe, expect, it } from "vitest";
import { developmentTargetsKey } from "./useDevelopmentTargets";

describe("developmentTargetsKey", () => {
  it("scopes server state by vault", () => {
    expect(developmentTargetsKey("reef-a")).toEqual([
      "development-targets",
      "reef-a",
    ]);
  });
});
