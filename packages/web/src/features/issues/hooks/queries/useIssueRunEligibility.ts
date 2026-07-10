"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  type IssueRunRequestEligibility,
  IssueRunRequestEligibilitySchema,
} from "@reef/core";
import { useQuery } from "@tanstack/react-query";

export function issueRunEligibilityKey(vault: string, issueId: string) {
  return ["issues", "run-eligibility", vault, issueId] as const;
}

export function useIssueRunEligibility(vault: string, issueId: string) {
  return useQuery<IssueRunRequestEligibility, Error>({
    queryKey: issueRunEligibilityKey(vault, issueId),
    queryFn: async () => {
      const response = await apiFetch(
        `/api/issues/${encodeURIComponent(issueId)}/run-eligibility?vault=${encodeURIComponent(vault)}`,
      );
      if (!response.ok) {
        await throwHttpError(
          response,
          `Issue run eligibility returned ${response.status}`,
        );
      }
      return IssueRunRequestEligibilitySchema.parse(await response.json());
    },
    enabled: vault.length > 0 && issueId.length > 0,
    staleTime: 10_000,
    refetchOnMount: "always",
    retry: false,
  });
}
