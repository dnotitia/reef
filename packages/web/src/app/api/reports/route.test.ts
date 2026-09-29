// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockRouteLogger,
  mockRouteTelemetry,
} from "../__test-helpers__/routeMocks";

mockRouteTelemetry();
mockRouteLogger();

const { mockAkbGetReports } = vi.hoisted(() => ({
  mockAkbGetReports: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return { ...actual, akbGetReports: mockAkbGetReports };
});

import { akbGetReports } from "@reef/core";
import { authedHeaders } from "../__test-helpers__/routeMocks";
import { GET } from "./route";

describe("GET /api/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    vi.spyOn(Date, "now").mockReturnValue(1_779_753_600_000);
    mockAkbGetReports.mockResolvedValue({
      issueCount: 1,
      aggregates: { filteredTotal: 1 },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects malformed report filters before invoking core", async () => {
    const request = new Request(
      "http://localhost/api/reports?vault=reef-acme&period=fortnight",
      { headers: authedHeaders() },
    );

    const response = await GET(request);

    expect(response.status).toBe(422);
    expect(akbGetReports).not.toHaveBeenCalled();
  });

  it("passes all filters and axes to core and returns its report payload", async () => {
    const request = new Request(
      "http://localhost/api/reports?vault=reef-acme&period=4w&scope=all&measure=points&asOf=1779753600000&sprint_id=sprint-1&milestone_id=milestone-1&release_id=release-1&parent_id=REEF-001&assignee=alice&label=docs&rollupDimension=sprint&pivotRow=type&pivotCol=priority",
      { headers: authedHeaders() },
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      issueCount: 1,
      aggregates: { filteredTotal: 1 },
    });
    expect(akbGetReports).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        request: {
          filters: {
            period: "4w",
            scope: "all",
            measure: "points",
            sprint_id: "sprint-1",
            milestone_id: "milestone-1",
            release_id: "release-1",
            parent_id: "REEF-001",
            assignee: "alice",
            label: "docs",
          },
          asOf: 1_779_753_600_000,
          rollupDimension: "sprint",
          pivotRow: "type",
          pivotCol: "priority",
        },
      }),
    );
  });

  it("rejects identical pivot axes", async () => {
    const request = new Request(
      "http://localhost/api/reports?vault=reef-acme&pivotRow=type&pivotCol=type",
      { headers: authedHeaders() },
    );

    const response = await GET(request);

    expect(response.status).toBe(422);
    expect(akbGetReports).not.toHaveBeenCalled();
  });
});
