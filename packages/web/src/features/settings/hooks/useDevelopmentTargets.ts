"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  type DevelopmentTargetConfig,
  type DevelopmentTargetItem,
  type DevelopmentTargetsResponse,
  DevelopmentTargetsResponseSchema,
  resolveDevelopmentTargetEligibility,
} from "@reef/core";
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

const STALE_TIME_MS = 60_000;

export function developmentTargetsKey(vault: string) {
  return ["development-targets", vault] as const;
}

async function fetchDevelopmentTargets(
  vault: string,
): Promise<DevelopmentTargetsResponse> {
  const response = await apiFetch(
    `/api/development-targets?vault=${encodeURIComponent(vault)}`,
  );
  if (!response.ok) {
    await throwHttpError(
      response,
      `Development target fetch returned ${response.status}`,
    );
  }
  return DevelopmentTargetsResponseSchema.parse(await response.json());
}

export function useDevelopmentTargets(
  vault: string,
): UseQueryResult<DevelopmentTargetsResponse, Error> {
  return useQuery({
    queryKey: developmentTargetsKey(vault),
    queryFn: () => fetchDevelopmentTargets(vault),
    enabled: vault.length > 0,
    staleTime: STALE_TIME_MS,
    retry: false,
  });
}

export interface UpdateDevelopmentTargetArgs {
  githubId: number;
  target: Omit<DevelopmentTargetConfig, "github_id">;
}

export function useUpdateDevelopmentTarget(
  vault: string,
): UseMutationResult<
  DevelopmentTargetConfig,
  Error,
  UpdateDevelopmentTargetArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ githubId, target }) => {
      const response = await apiFetch(`/api/development-targets/${githubId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vault, target }),
      });
      if (!response.ok) {
        await throwHttpError(
          response,
          `Development target update returned ${response.status}`,
        );
      }
      const data = (await response.json()) as {
        target: DevelopmentTargetConfig;
      };
      return data.target;
    },
    onSuccess: (target) => {
      const queryKey = developmentTargetsKey(vault);
      queryClient.setQueryData<DevelopmentTargetsResponse>(
        queryKey,
        (current) => {
          if (!current) return current;
          const items: DevelopmentTargetItem[] = current.items.map((item) =>
            item.repo.github_id === target.github_id
              ? {
                  ...item,
                  config: target,
                  eligibility: resolveDevelopmentTargetEligibility({
                    config: target,
                    catalog: current.catalog,
                  }),
                }
              : item,
          );
          return { ...current, items };
        },
      );
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}
