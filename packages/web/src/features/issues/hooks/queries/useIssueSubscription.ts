"use client";

import { fetchIssueSubscription } from "@/features/issues/lib/issueSubscription.actions";
import { useQuery } from "@tanstack/react-query";

export function issueSubscriptionKey(vault: string, issueId: string) {
  return ["issues", "subscription", vault, issueId] as const;
}

export function useIssueSubscription(issueId: string, vault: string) {
  return useQuery({
    queryKey: issueSubscriptionKey(vault, issueId),
    queryFn: () => fetchIssueSubscription(issueId, vault),
    enabled: Boolean(issueId && vault),
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
}
