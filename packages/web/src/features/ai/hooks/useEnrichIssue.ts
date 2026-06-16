"use client";

import { apiFetch } from "@/lib/apiClient";
import type { EnrichmentRequest, EnrichmentResult } from "@reef/core";
import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

/**
 * Error type carrying the HTTP status so the panel can render different
 * states for deployment AI unavailable (503) vs GitHub auth (401) vs
 * unexpected (400/500). The plain `Error.message` is the PM-vocabulary
 * string returned by the route, suitable for direct display.
 */
export interface EnrichIssueError extends Error {
  status: number;
}

function asEnrichError(message: string, status: number): EnrichIssueError {
  const err = new Error(message) as EnrichIssueError;
  err.status = status;
  return err;
}

/**
 * AI-assisted enrichment hook backed by `POST /api/enrich`.
 *
 * No query invalidation runs on success — enrichment produces draft
 * suggestions that the user should accept individually inside the panel. The
 * caller (NewIssueDialog) applies accepted suggestions to its local form
 * state and saves through the normal create-issue path.
 *
 * Graceful degradation: every non-2xx maps to an `EnrichIssueError` carrying
 * the HTTP status, so the panel can decide whether to show "AI unavailable"
 * or a retryable error.
 */
type EnrichIssueOptions = Pick<
  UseMutationOptions<EnrichmentResult, EnrichIssueError, EnrichmentRequest>,
  "onSuccess"
>;

export function useEnrichIssue(options: EnrichIssueOptions = {}) {
  return useMutation<EnrichmentResult, EnrichIssueError, EnrichmentRequest>({
    mutationKey: ["ai", "enrich"],
    mutationFn: async (
      request: EnrichmentRequest,
    ): Promise<EnrichmentResult> => {
      const res = await apiFetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (res.ok) {
        return (await res.json()) as EnrichmentResult;
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const fallback =
        res.status === 401
          ? "Reconnect GitHub in Settings to enable AI enrichment."
          : res.status === 503
            ? "AI enrichment is unavailable. You can still save the issue without it."
            : `Enrichment failed: ${res.status}`;
      throw asEnrichError(body.error ?? fallback, res.status);
    },
    ...options,
  });
}
