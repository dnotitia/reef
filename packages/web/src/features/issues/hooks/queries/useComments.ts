import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { Comment } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

/**
 * Vault-scoped query key for an issue's comment thread, parallel to the
 * references key (REEF-098 keying convention). The mutations target the same
 * key so a posted/edited comment lands in the cached thread.
 */
export function commentsKey(vault: string, issueId: string) {
  return ["issues", "comments", vault, issueId] as const;
}

/** Load an issue's flat comment thread, oldest-first (server-ordered). */
export function useComments(issueId: string, vault: string) {
  return useQuery({
    queryKey: commentsKey(vault, issueId),
    queryFn: async (): Promise<Comment[]> => {
      const res = await apiFetch(
        `/api/issues/${encodeURIComponent(issueId)}/comments?vault=${encodeURIComponent(
          vault,
        )}`,
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to load comments: ${res.status}`);
      }
      const body = (await res.json()) as { comments: Comment[] };
      return body.comments;
    },
    enabled: !!issueId && !!vault,
    staleTime: 30_000,
  });
}
