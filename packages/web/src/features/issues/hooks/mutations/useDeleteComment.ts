"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  CommentDeletionResultSchema,
  type Comment,
  type CommentDeletionResult,
} from "@reef/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commentsKey } from "../queries/useComments";

interface DeleteCommentInput {
  issueId: string;
  vault: string;
  commentId: string;
}

/**
 * Hard-delete an authored comment subtree. The server returns the exact ids
 * removed by its recursive cascade, so the comments cache can converge from
 * that confirmed result without an optimistic hide. Notification queries are
 * invalidated because the same server statement removes comment-source rows.
 */
export function useDeleteComment() {
  const queryClient = useQueryClient();

  return useMutation<CommentDeletionResult, Error, DeleteCommentInput>({
    mutationFn: async ({ issueId, vault, commentId }) => {
      const response = await apiFetch(
        `/api/issues/${encodeURIComponent(issueId)}/comments/${encodeURIComponent(
          commentId,
        )}?vault=${encodeURIComponent(vault)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        await throwHttpError(
          response,
          `Failed to delete comment: ${response.status}`,
        );
      }
      return CommentDeletionResultSchema.parse(await response.json());
    },
    onSuccess: (deletion, { issueId, vault }) => {
      const deleted = new Set(deletion.deleted_comment_ids);
      queryClient.setQueryData<Comment[]>(
        commentsKey(vault, issueId),
        (current) => current?.filter((comment) => !deleted.has(comment.id)),
      );
      void queryClient.invalidateQueries({
        queryKey: ["notifications", vault],
      });
    },
  });
}
