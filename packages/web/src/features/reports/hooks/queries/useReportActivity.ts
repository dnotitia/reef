import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { useHydrated } from "@/lib/useHydrated";
import type { ActivityEvent } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

/** Load all status changes for a vault in one request for local report filtering. */
export function useReportActivity(vault: string) {
  const hydrated = useHydrated();
  const result = useQuery({
    queryKey: ["reports", "activity", vault] as const,
    queryFn: async (): Promise<ActivityEvent[]> => {
      const res = await apiFetch(
        `/api/reports/activity?vault=${encodeURIComponent(vault)}`,
      );
      if (!res.ok) {
        await throwHttpError(
          res,
          `Failed to load report activity: ${res.status}`,
        );
      }
      const body = (await res.json()) as { activity: ActivityEvent[] };
      return body.activity;
    },
    enabled: !!vault,
    staleTime: 30_000,
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
