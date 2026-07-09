"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { useHydrated } from "@/lib/useHydrated";
import {
  type Milestone,
  MilestoneSchema,
  type PlanningCatalog,
  PlanningCatalogSchema,
  type Release,
  ReleaseSchema,
  type Sprint,
  SprintSchema,
} from "@reef/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type PlanningKind = "sprints" | "milestones" | "releases";
export type PlanningItem = Sprint | Milestone | Release;
export type PlanningInput =
  | Omit<Sprint, "id">
  | Omit<Milestone, "id">
  | Omit<Release, "id">;

const planningCatalogKey = (vault: string) =>
  ["planning", "catalog", vault] as const;

async function fetchPlanningCatalog(vault: string): Promise<PlanningCatalog> {
  const res = await apiFetch(
    `/api/planning?vault=${encodeURIComponent(vault)}`,
  );
  if (!res.ok) {
    await throwHttpError(res, `Planning fetch returned ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  return PlanningCatalogSchema.parse(data);
}

export function usePlanningCatalog(vault: string) {
  const hydrated = useHydrated();
  const result = useQuery({
    queryKey: planningCatalogKey(vault),
    queryFn: () => fetchPlanningCatalog(vault),
    enabled: vault.length > 0,
    staleTime: 60_000,
  });

  // Hydration gate. Like issue lists, planning catalog data can be restored
  // from PersistQueryClientProvider before the first client render while SSR
  // rendered the pending skeleton. Keep that first render SSR-shaped, then let
  // the cached catalog appear after mount.
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

function schemaFor(kind: PlanningKind) {
  if (kind === "sprints") return SprintSchema;
  if (kind === "milestones") return MilestoneSchema;
  return ReleaseSchema;
}

export function useCreatePlanningItem(vault: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      kind,
      item,
    }: {
      kind: PlanningKind;
      item: PlanningInput;
    }) => {
      const res = await apiFetch(`/api/planning/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vault, item }),
      });
      if (!res.ok) {
        await throwHttpError(
          res,
          `Create planning item returned ${res.status}`,
        );
      }
      const data = (await res.json()) as { item: unknown };
      return schemaFor(kind).parse(data.item) as PlanningItem;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: planningCatalogKey(vault),
      });
    },
  });
}

export function useUpdatePlanningItem(vault: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      kind,
      item,
    }: {
      kind: PlanningKind;
      item: PlanningItem;
    }) => {
      const res = await apiFetch(
        `/api/planning/${kind}/${encodeURIComponent(item.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vault, item }),
        },
      );
      if (!res.ok) {
        await throwHttpError(
          res,
          `Update planning item returned ${res.status}`,
        );
      }
      const data = (await res.json()) as { item: unknown };
      return schemaFor(kind).parse(data.item) as PlanningItem;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: planningCatalogKey(vault),
      });
      await queryClient.invalidateQueries({
        queryKey: ["issues", "list", vault],
      });
    },
  });
}

export function useDeletePlanningItem(vault: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      kind,
      id,
    }: {
      kind: PlanningKind;
      id: string;
    }) => {
      const res = await apiFetch(
        `/api/planning/${kind}/${encodeURIComponent(id)}?vault=${encodeURIComponent(vault)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 204) {
        await throwHttpError(
          res,
          `Delete planning item returned ${res.status}`,
        );
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: planningCatalogKey(vault),
      });
      await queryClient.invalidateQueries({
        queryKey: ["issues", "list", vault],
      });
    },
  });
}
