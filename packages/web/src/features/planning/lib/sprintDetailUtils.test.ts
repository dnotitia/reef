// @vitest-environment node

import type { Sprint } from "@reef/core";
import { describe, expect, it } from "vitest";
import { sprintTimeState } from "./sprintDetailUtils";

const sprint = (end_date: string | null): Pick<Sprint, "end_date"> => ({
  end_date,
});

const today = Date.parse("2026-09-02T12:00:00.000Z");

describe("sprintTimeState", () => {
  it("reports remaining calendar days through the end date", () => {
    expect(sprintTimeState(sprint("2026-09-05"), today)).toEqual({
      kind: "remaining",
      days: 3,
    });
  });

  it("reports elapsed calendar days after the end date", () => {
    expect(sprintTimeState(sprint("2026-08-30"), today)).toEqual({
      kind: "elapsed",
      days: 3,
    });
  });

  it("returns no state for a missing or malformed end date", () => {
    expect(sprintTimeState(sprint(null), today)).toBeNull();
    expect(sprintTimeState(sprint("not-a-date"), today)).toBeNull();
  });
});
