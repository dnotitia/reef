import {
  createQueryWrapper,
  createTestQueryClient,
} from "@/test-support/query";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hydratedRef } = vi.hoisted(() => ({
  hydratedRef: { current: true },
}));

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

vi.mock("@/lib/useHydrated", () => ({
  useHydrated: () => hydratedRef.current,
}));

import { apiFetch } from "@/lib/apiClient";
import { useReports } from "@/features/reports/hooks/queries/useReports";
import {
  ReportRequestSchema,
  type PlanningCatalog,
  type ReportResponse,
} from "@reef/core";
import {
  useCreatePlanningItem,
  usePlanningCatalog,
} from "./usePlanningCatalog";

const mockApiFetch = vi.mocked(apiFetch);

const CATALOG: PlanningCatalog = {
  sprints: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Sprint One",
      status: "active",
      start_date: "2026-06-01",
      end_date: "2026-06-14",
      goal: "Ship the board",
      capacity_points: null,
    },
  ],
  milestones: [],
  releases: [],
  rollover_resumes: [],
};

describe("usePlanningCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hydratedRef.current = true;
  });

  it("calls GET /api/planning?vault={vault} and returns the catalog", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify(CATALOG), { status: 200 }),
    );

    const { result } = renderHook(() => usePlanningCatalog("reef-acme"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(CATALOG);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/planning?vault=reef-acme");
  });

  it("refreshes report data after creating a planning item", async () => {
    const sprint = CATALOG.sprints[0];
    if (!sprint) throw new Error("expected a planning fixture sprint");
    const input = {
      name: sprint.name,
      status: sprint.status,
      start_date: sprint.start_date,
      end_date: sprint.end_date,
      goal: sprint.goal,
      capacity_points: sprint.capacity_points,
    };
    const request = ReportRequestSchema.parse({ asOf: 1_780_272_000_000 });
    const flow = {
      completionWindowCount: 0,
      measuredCount: 0,
      coveragePercent: 0,
      points: [],
      percentiles: null,
      sleDays: null,
      lowSample: true,
      outliers: [],
    };
    const report: ReportResponse = {
      asOf: request.asOf,
      issueCount: 0,
      parentName: null,
      availableDimensions: [],
      rollupDimension: "milestone",
      aggregates: {
        filteredTotal: 0,
        total: 0,
        byStatus: [],
        byPriority: [],
        topAssignees: [],
        topLabels: [],
        kpis: {
          active: 0,
          inProgress: 0,
          done: 0,
          overdue: 0,
          blocked: 0,
          unassigned: 0,
        },
        byType: [],
        bySeverity: [],
        throughput: [],
        netThroughput: [],
        dueHealth: { overdue: 0, dueThisWeek: 0, upcoming: 0, noDueDate: 0 },
        aging: { fresh: 0, recent: 0, stale: 0, stalled: 0 },
        riskSummary: {
          atRisk: 0,
          overdue: 0,
          stale: 0,
          blocked: 0,
          critical: 0,
          netThroughput: 0,
        },
        riskMatrix: [],
      },
      flowMetrics: { cycle: flow, lead: flow },
      flowMetricsUnavailable: false,
      forecast: {
        remaining: 0,
        horizonWeeks: 12,
        sampleWeeks: 0,
        totalThroughput: 0,
        productiveWeeks: 0,
        lowConfidence: true,
        insufficient: true,
        completion: [],
        byDate: [],
      },
      healthRollup: [],
      pivot: {
        rowField: "assignee",
        colField: "status",
        rows: [],
        cols: [],
        cells: [],
        rowTotals: [],
        colTotals: [],
        grandTotal: 0,
        max: 0,
        rowsFolded: 0,
        colsFolded: 0,
      },
    };
    let created = false;
    mockApiFetch.mockImplementation(async (url, init) => {
      if (String(url) === "/api/planning/sprints" && init?.method === "POST") {
        created = true;
        return new Response(JSON.stringify({ item: sprint }), { status: 201 });
      }
      if (String(url).startsWith("/api/reports?")) {
        return new Response(
          JSON.stringify({
            ...report,
            availableDimensions: created ? ["sprint"] : [],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        reports: useReports("reef-acme", request),
        create: useCreatePlanningItem("reef-acme"),
      }),
      {
        wrapper: createQueryWrapper(queryClient),
      },
    );
    await waitFor(() => expect(result.current.reports.isSuccess).toBe(true));
    expect(result.current.reports.data?.availableDimensions).toEqual([]);
    await act(async () => {
      await result.current.create.mutateAsync({ kind: "sprints", item: input });
    });
    await waitFor(() =>
      expect(result.current.reports.data?.availableDimensions).toEqual([
        "sprint",
      ]),
    );
  });

  it("keeps a catalog failure distinct and refetches to a successful catalog", async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "temporary failure" }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(CATALOG), { status: 200 }),
      );

    const { result } = renderHook(() => usePlanningCatalog("reef-acme"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();

    await result.current.refetch();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(CATALOG);
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("is disabled when vault is empty", () => {
    const { result } = renderHook(() => usePlanningCatalog(""), {
      wrapper: createQueryWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("keeps restored cache hidden during the hydration render", () => {
    hydratedRef.current = false;
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["planning", "catalog", "reef-acme"], CATALOG);

    const { result, rerender } = renderHook(
      () => usePlanningCatalog("reef-acme"),
      { wrapper: createQueryWrapper(queryClient) },
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isSuccess).toBe(false);

    hydratedRef.current = true;
    rerender();

    expect(result.current.data).toEqual(CATALOG);
    expect(result.current.isSuccess).toBe(true);
  });

  it("reuses a fresh shared catalog cache without creating a duplicate request", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["planning", "catalog", "reef-acme"], CATALOG);

    const { result } = renderHook(() => usePlanningCatalog("reef-acme"), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(CATALOG);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});
