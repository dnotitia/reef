import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { useHydrated } from "@/lib/useHydrated";
import {
  ReportResponseSchema,
  type ReportRequest,
  type ReportResponse,
} from "@reef/core";
import { useQuery } from "@tanstack/react-query";
import { reportsDataQueryKey } from "../../lib/queryKey";

async function fetchReports(
  vault: string,
  request: ReportRequest,
  signal?: AbortSignal,
): Promise<ReportResponse> {
  const params = new URLSearchParams({
    vault,
    period: request.filters.period,
    scope: request.filters.scope,
    measure: request.filters.measure,
    asOf: String(request.asOf),
    rollupDimension: request.rollupDimension,
    pivotRow: request.pivotRow,
    pivotCol: request.pivotCol,
  });
  for (const key of [
    "sprint_id",
    "milestone_id",
    "release_id",
    "parent_id",
    "assignee",
    "label",
  ] as const) {
    const value = request.filters[key];
    if (value !== undefined) params.set(key, value);
  }

  const response = await apiFetch(`/api/reports?${params.toString()}`, {
    signal,
  });
  if (!response.ok) {
    await throwHttpError(response, `Reports fetch returned ${response.status}`);
  }
  return ReportResponseSchema.parse((await response.json()) as unknown);
}

export function useReports(vault: string, request: ReportRequest) {
  const hydrated = useHydrated();
  const result = useQuery({
    queryKey: reportsDataQueryKey(vault, request),
    queryFn: ({ signal }) => fetchReports(vault, request, signal),
    enabled: vault.length > 0,
    staleTime: 60_000,
  });

  if (!hydrated) {
    return {
      ...result,
      data: undefined,
      error: null,
      isPending: true,
      isLoading: false,
      isLoadingError: false,
      isRefetchError: false,
      isSuccess: false,
      isError: false,
      status: "pending",
      fetchStatus: "idle",
    } as typeof result;
  }
  return result;
}
