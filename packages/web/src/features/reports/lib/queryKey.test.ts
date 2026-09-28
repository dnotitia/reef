import { ReportRequestSchema } from "@reef/core";
import { describe, expect, it } from "vitest";
import { reportsDataQueryKey, reportsQueryKey } from "./queryKey";

describe("reports query keys", () => {
  it("scopes results by vault and every result-changing request field", () => {
    const request = ReportRequestSchema.parse({ asOf: 1_779_753_600_000 });
    const base = reportsDataQueryKey("reef-acme", request);
    const changedRequests = [
      { ...request, asOf: request.asOf + 1 },
      { ...request, filters: { ...request.filters, period: "4w" as const } },
      { ...request, filters: { ...request.filters, scope: "all" as const } },
      {
        ...request,
        filters: { ...request.filters, measure: "points" as const },
      },
      {
        ...request,
        filters: { ...request.filters, sprint_id: "sprint-1" },
      },
      {
        ...request,
        filters: { ...request.filters, milestone_id: "milestone-1" },
      },
      {
        ...request,
        filters: { ...request.filters, release_id: "release-1" },
      },
      { ...request, filters: { ...request.filters, parent_id: "REEF-001" } },
      { ...request, filters: { ...request.filters, assignee: "alice" } },
      { ...request, filters: { ...request.filters, label: "docs" } },
      { ...request, rollupDimension: "sprint" as const },
      { ...request, pivotRow: "type" as const },
      { ...request, pivotCol: "priority" as const },
    ];

    expect(base.slice(0, 2)).toEqual(reportsQueryKey("reef-acme"));
    expect(reportsDataQueryKey("reef-zeta", request)).not.toEqual(base);
    for (const changed of changedRequests) {
      expect(reportsDataQueryKey("reef-acme", changed)).not.toEqual(base);
    }
  });
});
