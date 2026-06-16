"use client";

import { useQuery } from "@tanstack/react-query";

export interface AiAvailableState {
  /** True when deployment-managed LLM config is complete and valid. */
  isAvailable: boolean;
  /** True while the deployment status request is in flight. */
  isLoading: boolean;
  provider: "openrouter";
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
  const query = useQuery({
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
        provider: "openrouter";
        model: string | null;
      };
    },
    staleTime: 60_000,
    retry: false,
  });

  return {
    isAvailable: query.data?.isConfigured ?? false,
    isLoading: query.isLoading,
    provider: query.data?.provider ?? "openrouter",
    model: query.data?.model ?? null,
  };
}
