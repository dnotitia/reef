"use client";

import { useQuery } from "@tanstack/react-query";

export interface GithubAppAvailableState {
  /**
   * True when the deployment is configured to mint a server-managed GitHub App
   * installation token, so monitored-repo grounding works without a per-user
   * browser PAT.
   */
  isAvailable: boolean;
  /** True while the deployment status request is in flight. */
  isLoading: boolean;
  /** GitHub's App id, surfaced for diagnostics. Not the private key. */
  appId: string | null;
}

/**
 * Exposes deployment-managed GitHub App availability, mirroring
 * `useAiAvailable`. Gates the monitored-repo picker so a workspace whose
 * deployment has a GitHub App configured lists and saves repos without each
 * browser user supplying a personal access token (REEF-239 AC1/AC2).
 *
 * Like `useAiAvailable`, this exposes the boolean capability and the
 * non-secret App id — not the credential. `staleTime` keeps it from re-probing
 * on every mount; deployment config does not change within a session.
 */
export function useGithubAppAvailable(): GithubAppAvailableState {
  const query = useQuery({
    queryKey: ["github", "status"],
    queryFn: async () => {
      const res = await fetch("/api/github/status", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(`GitHub App status failed (${res.status})`);
      }
      return (await res.json()) as {
        isConfigured: boolean;
        appId: string | null;
      };
    },
    staleTime: 60_000,
    retry: false,
  });

  return {
    isAvailable: query.data?.isConfigured ?? false,
    isLoading: query.isLoading,
    appId: query.data?.appId ?? null,
  };
}
