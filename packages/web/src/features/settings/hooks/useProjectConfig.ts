"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { holdQueryUntilHydrated } from "@/lib/queryHydration";
import { useHydrated } from "@/lib/useHydrated";
import {
  type AuthoringLanguage,
  type Config,
  ConfigSchema,
  type MonitoredRepo,
} from "@reef/core";
import {
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

export interface ProjectConfigResult {
  config: Config;
}

export interface ConfigPatch {
  project_prefix?: string;
  monitored_repos?: MonitoredRepo[];
  /** Workspace default authoring language (REEF-136); null clears it. */
  authoring_language?: AuthoringLanguage | null;
  stale_hide_completed_days?: number;
  stale_hide_canceled_days?: number;
  /** Workspace AI-activity-scanning kill switch (REEF-313). */
  ai_scanning_enabled?: boolean;
}

const STALE_TIME_MS = 60_000;

function projectConfigKey(vault: string): readonly unknown[] {
  return ["config", vault] as const;
}

async function fetchProjectConfig(vault: string): Promise<ProjectConfigResult> {
  const res = await apiFetch(`/api/config?vault=${encodeURIComponent(vault)}`);

  if (!res.ok) {
    await throwHttpError(res, `Project config fetch returned ${res.status}`);
  }

  const data = (await res.json()) as { config: unknown };
  const config = ConfigSchema.parse(data.config);
  return { config };
}

export function useProjectConfig(
  vault: string,
): UseQueryResult<ProjectConfigResult, Error> {
  const hydrated = useHydrated();
  const result = useQuery({
    queryKey: projectConfigKey(vault),
    queryFn: () => fetchProjectConfig(vault),
    enabled: vault.length > 0,
    staleTime: STALE_TIME_MS,
    retry: false,
  });

  // Keep a restored ["config", vault] snapshot out of the first hydration
  // render. The server always starts pending, while PersistQueryClientProvider
  // can otherwise make settings and activity consumers render loaded state
  // immediately in the browser, changing both permission-gated controls and
  // read-only empty states before React has matched the server HTML.
  return holdQueryUntilHydrated(result, hydrated);
}

/**
 * Imperative variant of `useProjectConfig` for async handlers (submit, scan).
 * Shares the same `['config', vault]` cache so a fresh page mount's pending
 * query and a submit handler's `ensureProjectConfig` deduplicate to one fetch.
 */
export function ensureProjectConfig(
  queryClient: QueryClient,
  vault: string,
): Promise<ProjectConfigResult> {
  return queryClient.fetchQuery({
    queryKey: projectConfigKey(vault),
    queryFn: () => fetchProjectConfig(vault),
    staleTime: STALE_TIME_MS,
  });
}

export interface MutateConfigArgs {
  patch: ConfigPatch;
}

export type ConfigMutation = UseMutationResult<
  ProjectConfigResult,
  Error,
  MutateConfigArgs
>;

export function useUpdateProjectConfig(vault: string): ConfigMutation {
  const queryClient = useQueryClient();

  return useMutation<ProjectConfigResult, Error, MutateConfigArgs>({
    mutationFn: async ({ patch }) => {
      const res = await apiFetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vault, patch }),
      });

      if (!res.ok) {
        await throwHttpError(res, `PATCH /api/config returned ${res.status}`);
      }

      const data = (await res.json()) as { config: unknown };
      const config = ConfigSchema.parse(data.config);
      return { config };
    },
    onSuccess: (result) => {
      const queryKey = projectConfigKey(vault);
      queryClient.setQueryData(queryKey, result);
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}
