"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { IssueAttachment } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

export const issueAttachmentsKey = (vault: string, issueId: string) =>
  ["issues", "attachments", vault, issueId] as const;

export function useIssueAttachments(issueId: string, vault: string) {
  return useQuery({
    queryKey: issueAttachmentsKey(vault, issueId),
    queryFn: async () => {
      const res = await apiFetch(
        `/api/issues/${encodeURIComponent(issueId)}/attachments?vault=${encodeURIComponent(
          vault,
        )}`,
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to load attachments: ${res.status}`);
      }
      const data = (await res.json()) as { attachments: IssueAttachment[] };
      return data.attachments;
    },
  });
}
