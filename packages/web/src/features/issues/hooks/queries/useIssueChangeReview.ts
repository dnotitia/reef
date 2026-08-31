"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  IssueChangeReviewResponseSchema,
  type IssueChangeReviewRange,
  type IssueChangeReviewResponse,
} from "@reef/core";
import { useQuery } from "@tanstack/react-query";

export function issueChangeReviewKey(
  vault: string,
  range: IssueChangeReviewRange | null,
) {
  return [
    "issues",
    "change-review",
    vault,
    range?.start_at ?? null,
    range?.end_at ?? null,
  ] as const;
}

/** Load the immutable range selection and grouped issue changes. */
export function useIssueChangeReview(
  vault: string,
  range: IssueChangeReviewRange | null,
) {
  return useQuery({
    queryKey: issueChangeReviewKey(vault, range),
    queryFn: async (): Promise<IssueChangeReviewResponse> => {
      if (!range) throw new Error("change review range is required");
      const params = new URLSearchParams({
        vault,
        start_at: range.start_at,
        end_at: range.end_at,
      });
      const response = await apiFetch(`/api/issues/changes?${params}`);
      if (!response.ok) {
        await throwHttpError(
          response,
          `Failed to load issue changes: ${response.status}`,
        );
      }
      return IssueChangeReviewResponseSchema.parse(await response.json());
    },
    enabled: Boolean(vault && range),
    staleTime: 30_000,
  });
}
