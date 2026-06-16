"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface DeleteIssueInput {
  id: string;
  vault: string;
}

/**
 * Permanently delete an issue document. 204 → invalidate list+detail; 404
 * is treated as soft success (already gone). The reversible alternative is
 * PATCH with `archived_at`; this hook is gated behind a confirm dialog.
 */
export function useDeleteIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, vault }: DeleteIssueInput): Promise<void> => {
      const params = new URLSearchParams({ vault });
      const res = await apiFetch(
        `/api/issues/${encodeURIComponent(id)}?${params.toString()}`,
        { method: "DELETE" },
      );
      if (res.status === 204 || res.status === 404) return;
      await throwHttpError(res, `Delete failed: ${res.status}`);
    },
    onSuccess: (_data, { id, vault }) => {
      void queryClient.invalidateQueries({
        queryKey: ["issues", "list", vault],
      });
      void queryClient.invalidateQueries({
        queryKey: ["issues", "relations", vault],
      });
      void queryClient.invalidateQueries({
        queryKey: ["issues", "detail", vault, id],
      });
    },
  });
}
