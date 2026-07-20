"use client";

import { holdQueryUntilHydrated } from "@/lib/queryHydration";
import { useHydrated } from "@/lib/useHydrated";
import { useQuery } from "@tanstack/react-query";

export interface AiAvailableState {
  /** True when deployment-managed LLM config is complete and valid. */
  isAvailable: boolean;
  /** True while the deployment status request is in flight. */
  isLoading: boolean;
  model: string | null;
}

/**
 * Exposes deployment-managed AI feature availability.
 *
 * Use this hook to gate AI-specific features without exposing any secret
 * values. When `isAvailable` is false, show the inline deployment-unconfigured
 * state rather than blocking issue browsing.
 */
export function useAiAvailable(): AiAvailableState {
  const hydrated = useHydrated();
  const query = holdQueryUntilHydrated(
    useQuery({
      queryKey: ["ai", "status"],
      queryFn: async () => {
        const res = await fetch("/api/ai/status", {
          credentials: "same-origin",
        });
        if (!res.ok) {
          throw new Error(`AI status failed (${res.status})`);
        }
        return (await res.json()) as {
          isConfigured: boolean;
          model: string | null;
        };
      },
      staleTime: 60_000,
      retry: false,
    }),
    hydrated,
  );

  return {
    isAvailable: query.data?.isConfigured ?? false,
    isLoading: query.isPending,
    model: query.data?.model ?? null,
  };
}
