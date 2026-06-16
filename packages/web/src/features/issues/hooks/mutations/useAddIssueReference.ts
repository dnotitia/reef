"use client";

import { issueReferencesKey } from "@/features/issues/hooks/queries/useIssueReferences";
import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { AkbDocumentReference } from "@reef/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface AddIssueReferenceInput {
  issueId: string;
  vault: string;
  targetUri: string;
}

/**
 * Add an issue → akb document `references` edge. The route returns the refreshed
 * list (akb resolves the linked document's title), so we replace the cache from
 * the response rather than guessing a title optimistically.
 */
export function useAddIssueReference() {
  const queryClient = useQueryClient();

  return useMutation<AkbDocumentReference[], Error, AddIssueReferenceInput>({
    mutationFn: async ({ issueId, vault, targetUri }) => {
      const res = await apiFetch(
        `/api/issues/${encodeURIComponent(issueId)}/references?vault=${encodeURIComponent(vault)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_uri: targetUri }),
        },
      );
      if (!res.ok) {
        await throwHttpError(res, `Add reference failed: ${res.status}`);
      }
      const body = (await res.json()) as { references: AkbDocumentReference[] };
      return body.references;
    },
    onSuccess: (references, { issueId, vault }) => {
      queryClient.setQueryData(issueReferencesKey(vault, issueId), references);
    },
  });
}
