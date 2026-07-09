import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
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
import type { PlanningCatalog } from "@reef/core";
import { usePlanningCatalog } from "./usePlanningCatalog";

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
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function createWrapper(queryClient = createQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

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
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(CATALOG);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/planning?vault=reef-acme");
  });

  it("is disabled when vault is empty", () => {
    const { result } = renderHook(() => usePlanningCatalog(""), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("keeps restored cache hidden during the hydration render", () => {
    hydratedRef.current = false;
    const queryClient = createQueryClient();
    queryClient.setQueryData(["planning", "catalog", "reef-acme"], CATALOG);

    const { result, rerender } = renderHook(
      () => usePlanningCatalog("reef-acme"),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isSuccess).toBe(false);

    hydratedRef.current = true;
    rerender();

    expect(result.current.data).toEqual(CATALOG);
    expect(result.current.isSuccess).toBe(true);
  });
});
