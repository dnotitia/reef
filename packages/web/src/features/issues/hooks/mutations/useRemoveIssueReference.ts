"use client";

import { issueReferencesKey } from "@/features/issues/hooks/queries/useIssueReferences";
import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { AkbDocumentReference } from "@reef/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface RemoveIssueReferenceInput {
  issueId: string;
  vault: string;
  targetUri: string;
}

interface RemoveContext {
  previous?: AkbDocumentReference[];
}

/**
 * Remove an issue → akb document `references` edge. The card disappears
 * optimistically (the edge identity is its target URI), rolling back on error;
 * the server's refreshed list is the final canonical source.
 */
export function useRemoveIssueReference() {
  const queryClient = useQueryClient();

  return useMutation<
    AkbDocumentReference[],
    Error,
    RemoveIssueReferenceInput,
    RemoveContext
  >({
    mutationFn: async ({ issueId, vault, targetUri }) => {
      const res = await apiFetch(
        `/api/issues/${encodeURIComponent(issueId)}/references?vault=${encodeURIComponent(vault)}&target_uri=${encodeURIComponent(targetUri)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        await throwHttpError(res, `Remove reference failed: ${res.status}`);
      }
      const body = (await res.json()) as { references: AkbDocumentReference[] };
      return body.references;
    },
    onMutate: async ({ issueId, vault, targetUri }) => {
      const key = issueReferencesKey(vault, issueId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<AkbDocumentReference[]>(key);
      queryClient.setQueryData<AkbDocumentReference[]>(key, (current) =>
        current?.filter((ref) => ref.uri !== targetUri),
      );
      return { previous };
    },
    onError: (_err, { issueId, vault }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          issueReferencesKey(vault, issueId),
          context.previous,
        );
      }
    },
    onSuccess: (references, { issueId, vault }) => {
      queryClient.setQueryData(issueReferencesKey(vault, issueId), references);
    },
  });
}
