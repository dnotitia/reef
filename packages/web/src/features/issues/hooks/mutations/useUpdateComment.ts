import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { Comment } from "@reef/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commentsKey } from "../queries/useComments";

interface UpdateCommentInput {
  issueId: string;
  vault: string;
  commentId: string;
  body: string;
}

/**
 * Edit a comment's body. Ownership is enforced server-side (the update only
 * matches a row whose `meta.author` is the session actor), so a non-author edit
 * surfaces as a 404. On success the server-confirmed comment — carrying the new
 * `edited_at` — replaces its entry in the cached thread.
 */
export function useUpdateComment() {
  const queryClient = useQueryClient();

  return useMutation<Comment, Error, UpdateCommentInput>({
    mutationFn: async ({ issueId, vault, commentId, body }) => {
      const res = await apiFetch(
        `/api/issues/${encodeURIComponent(issueId)}/comments/${encodeURIComponent(
          commentId,
        )}?vault=${encodeURIComponent(vault)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to edit comment: ${res.status}`);
      }
      const data = (await res.json()) as { comment: Comment };
      return data.comment;
    },
    onSuccess: (comment, { issueId, vault }) => {
      queryClient.setQueryData<Comment[]>(
        commentsKey(vault, issueId),
        (current) =>
          current?.map((entry) => (entry.id === comment.id ? comment : entry)),
      );
    },
  });
}
