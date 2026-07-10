"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  type IssueRunRequestEligibility,
  type IssueRunRequestResult,
  IssueRunRequestResultSchema,
} from "@reef/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { issueRunEligibilityKey } from "../queries/useIssueRunEligibility";

interface RequestIssueRunArgs {
  githubId: number;
  requestId?: string;
}

interface RequestIssueRunOutcome extends IssueRunRequestResult {
  conflict: boolean;
}

export function useRequestIssueRun(vault: string, issueId: string) {
  const queryClient = useQueryClient();
  const queryKey = issueRunEligibilityKey(vault, issueId);
  return useMutation<RequestIssueRunOutcome, Error, RequestIssueRunArgs>({
    mutationFn: async ({ githubId, requestId }) => {
      const response = await apiFetch(
        `/api/issues/${encodeURIComponent(issueId)}/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vault,
            github_id: githubId,
            request_id: requestId ?? crypto.randomUUID(),
          }),
        },
      );
      if (response.status === 409) {
        const body = (await response.json()) as { run_id?: unknown };
        if (typeof body.run_id !== "string" || body.run_id.length === 0) {
          throw new Error("Active run response did not include a run id");
        }
        return {
          run_id: body.run_id,
          status: "queued",
          created: false,
          conflict: true,
        };
      }
      if (!response.ok) {
        if (response.status === 422) {
          void queryClient.invalidateQueries({ queryKey });
        }
        await throwHttpError(
          response,
          `Issue run request returned ${response.status}`,
        );
      }
      return {
        ...IssueRunRequestResultSchema.parse(await response.json()),
        conflict: false,
      };
    },
    onSuccess: (result) => {
      queryClient.setQueryData<IssueRunRequestEligibility>(
        queryKey,
        (current) =>
          current
            ? {
                ...current,
                eligible: false,
                reasons: ["run_already_active"],
                active_run: {
                  run_id: result.run_id,
                  status: "queued",
                  phase: "queued",
                },
              }
            : current,
      );
      void queryClient.invalidateQueries({ queryKey });
    },
    retry: false,
  });
}
