// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildStatusPatch } from "./statusPatch";

describe("buildStatusPatch", () => {
  it.each(["todo", "in_progress"] as const)(
    "returns only the target status for %s",
    (status) => expect(buildStatusPatch(status)).toEqual({ status }),
  );

  it("defaults the close reason to completed", () => {
    expect(buildStatusPatch("closed")).toEqual({
      status: "closed",
      closed_reason: "completed",
    });
  });

  it("uses the selected close reason", () => {
    expect(buildStatusPatch("closed", "duplicate")).toEqual({
      status: "closed",
      closed_reason: "duplicate",
    });
  });
});
