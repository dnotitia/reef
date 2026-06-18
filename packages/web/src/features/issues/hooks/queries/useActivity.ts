import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { ActivityEvent } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

/**
 * Vault-scoped query key for an issue's activity log, parallel to the comments
 * key (REEF-098 keying convention). The unified timeline (REEF-064) reads this
 * alongside `useComments` and merges both at render time.
 */
export function activityKey(vault: string, issueId: string) {
  return ["issues", "activity", vault, issueId] as const;
}

/** Load an issue's status-change activity events, oldest-first (server-ordered). */
export function useActivity(issueId: string, vault: string) {
  return useQuery({
    queryKey: activityKey(vault, issueId),
    queryFn: async (): Promise<ActivityEvent[]> => {
      const res = await apiFetch(
        `/api/issues/${encodeURIComponent(issueId)}/activity?vault=${encodeURIComponent(
          vault,
        )}`,
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to load activity: ${res.status}`);
      }
      const body = (await res.json()) as { activity: ActivityEvent[] };
      return body.activity;
    },
    enabled: !!issueId && !!vault,
    staleTime: 30_000,
  });
}
