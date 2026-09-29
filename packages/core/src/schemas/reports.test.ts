import { describe, expect, it } from "vitest";
import { MAX_REPORT_AS_OF_MS, ReportRequestSchema } from "./reports";

describe("ReportRequestSchema", () => {
  it("rejects asOf timestamps that cannot support report window arithmetic", () => {
    const request = {
      asOf: MAX_REPORT_AS_OF_MS,
      pivotRow: "assignee",
      pivotCol: "status",
    };

    expect(ReportRequestSchema.safeParse(request).success).toBe(true);
    expect(
      ReportRequestSchema.safeParse({
        ...request,
        asOf: MAX_REPORT_AS_OF_MS + 1,
      }).success,
    ).toBe(false);
    expect(
      ReportRequestSchema.safeParse({
        ...request,
        asOf: Number.MAX_SAFE_INTEGER,
      }).success,
    ).toBe(false);
  });
});
