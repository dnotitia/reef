"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { IssueAttachment, IssueAttachmentSource } from "@reef/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { activityKey } from "../queries/useActivity";
import { issueAttachmentsKey } from "../queries/useIssueAttachments";

export interface AttachmentUploadResult {
  attachment: IssueAttachment;
  markdown: string | null;
}

export interface UploadIssueAttachmentInput {
  issueId: string;
  vault: string;
  file: File;
  source: IssueAttachmentSource;
  inline: boolean;
}

export function useUploadIssueAttachment() {
  const queryClient = useQueryClient();
  return useMutation<AttachmentUploadResult, Error, UploadIssueAttachmentInput>(
    {
      mutationFn: async ({ issueId, vault, file, source, inline }) => {
        const body = new FormData();
        body.set("file", file);
        body.set("source", source);
        body.set("inline", inline ? "true" : "false");
        const res = await apiFetch(
          `/api/issues/${encodeURIComponent(issueId)}/attachments?vault=${encodeURIComponent(
            vault,
          )}`,
          { method: "POST", body },
        );
        if (!res.ok) {
          await throwHttpError(res, `Attachment upload failed: ${res.status}`);
        }
        return res.json() as Promise<AttachmentUploadResult>;
      },
      onSuccess: (_data, { issueId, vault }) => {
        void queryClient.invalidateQueries({
          queryKey: issueAttachmentsKey(vault, issueId),
        });
        void queryClient.invalidateQueries({
          queryKey: activityKey(vault, issueId),
        });
      },
    },
  );
}
