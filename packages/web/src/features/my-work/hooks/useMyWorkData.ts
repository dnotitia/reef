"use client";

import { issueRelationsQueryOptions } from "@/features/issues/hooks/queries/useIssueRelations";
import { planningCatalogQueryOptions } from "@/features/planning/hooks/usePlanningCatalog";
import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { holdQueryUntilHydrated } from "@/lib/queryHydration";
import { useHydrated } from "@/lib/useHydrated";
import { MyWorkResponseSchema, type MyWorkResponse } from "@reef/core";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";

export const myWorkQueryKey = (login: string) =>
  ["issues", "my-work", login] as const;

/** Shared, account-scoped in-memory query used by My Work and its sidebar badge. */
export function useMyWorkResponse() {
  const currentUser = useCurrentUser();
  const login = currentUser.data?.username?.trim() || null;
  const hydrated = useHydrated();
  const result = useQuery({
    queryKey: myWorkQueryKey(login ?? "anonymous"),
    queryFn: async ({ signal }): Promise<MyWorkResponse> => {
      const res = await apiFetch("/api/my-work", { signal });
      if (!res.ok) {
        await throwHttpError(res, `Failed to load your work: ${res.status}`);
      }
      return MyWorkResponseSchema.parse(await res.json());
    },
    enabled: Boolean(login),
    staleTime: 60_000,
    retry: false,
    meta: { persist: false },
  });
  const visible = holdQueryUntilHydrated(result, hydrated);

  return {
    ...visible,
    login,
    identityPending: currentUser.isPending,
    isPending: currentUser.isPending || (Boolean(login) && visible.isPending),
  };
}

export function useMyWorkData() {
  const response = useMyWorkResponse();
  const workspaces = response.data?.workspaces ?? [];
  const relations = useQueries({
    queries: workspaces.map(({ workspace }) =>
      issueRelationsQueryOptions(workspace),
    ),
  });
  const planning = useQueries({
    queries: workspaces.map(({ workspace }) =>
      planningCatalogQueryOptions(workspace),
    ),
  });
  const workspaceContexts = useMemo(
    () =>
      workspaces.map((workspace, index) => ({
        ...workspace,
        relations: relations[index]?.data ?? [],
        planning: planning[index]?.data ?? {
          sprints: [],
          milestones: [],
          releases: [],
          rollover_resumes: [],
        },
      })),
    [planning, relations, workspaces],
  );

  return { ...response, workspaceContexts };
}
