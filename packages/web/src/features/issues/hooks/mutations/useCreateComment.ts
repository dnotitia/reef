import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { Comment } from "@reef/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commentsKey } from "../queries/useComments";

interface CreateCommentInput {
  issueId: string;
  vault: string;
  body: string;
}

/**
 * Post a comment. The author is the session actor (server-derived), so the
 * client sends the body. On success the server-confirmed comment is
 * appended to the cached thread (no optimistic placeholder — mirrors
 * `useAddIssueReference`'s cache-replace pattern), keeping the rendered author /
 * timestamp identical to what was persisted.
 */
export function useCreateComment() {
  const queryClient = useQueryClient();

  return useMutation<Comment, Error, CreateCommentInput>({
    mutationFn: async ({ issueId, vault, body }) => {
      const res = await apiFetch(
        `/api/issues/${encodeURIComponent(issueId)}/comments?vault=${encodeURIComponent(
          vault,
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to add comment: ${res.status}`);
      }
      const data = (await res.json()) as { comment: Comment };
      return data.comment;
    },
    onSuccess: (comment, { issueId, vault }) => {
      queryClient.setQueryData<Comment[]>(
        commentsKey(vault, issueId),
        (current) => (current ? [...current, comment] : [comment]),
      );
    },
  });
}
