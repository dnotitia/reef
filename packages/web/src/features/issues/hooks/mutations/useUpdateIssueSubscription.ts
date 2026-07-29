"use client";

import {
  type IssueSubscriptionAction,
  updateIssueSubscription,
} from "@/features/issues/lib/issueSubscription.actions";
import type { EffectiveSubscriptionState } from "@reef/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { issueSubscriptionKey } from "../queries/useIssueSubscription";

interface UpdateIssueSubscriptionInput {
  issueId: string;
  vault: string;
  action: IssueSubscriptionAction;
}

interface UpdateIssueSubscriptionContext {
  key: ReturnType<typeof issueSubscriptionKey>;
  previous: EffectiveSubscriptionState | undefined;
}

export function useUpdateIssueSubscription() {
  const queryClient = useQueryClient();

  return useMutation<
    EffectiveSubscriptionState,
    Error,
    UpdateIssueSubscriptionInput,
    UpdateIssueSubscriptionContext
  >({
    mutationFn: updateIssueSubscription,
    onMutate: async ({ issueId, vault, action }) => {
      const key = issueSubscriptionKey(vault, issueId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous =
        queryClient.getQueryData<EffectiveSubscriptionState>(key);
      queryClient.setQueryData<EffectiveSubscriptionState>(
        key,
        action === "watch" ? "watching" : "muted",
      );
      return { key, previous };
    },
    onError: (_error, _input, context) => {
      if (!context) return;
      queryClient.setQueryData(context.key, context.previous);
    },
    onSuccess: (state, { issueId, vault }) => {
      queryClient.setQueryData(issueSubscriptionKey(vault, issueId), state);
    },
    onSettled: (_state, _error, { issueId, vault }) =>
      queryClient.invalidateQueries({
        queryKey: issueSubscriptionKey(vault, issueId),
        refetchType: "active",
      }),
  });
}
