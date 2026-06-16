"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type {
  IssueDocument,
  IssueListItem,
  IssueMetadata,
  IssueUpdatePatch,
} from "@reef/core";
import {
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

interface UpdateIssueInput {
  id: string;
  vault: string;
  patch: IssueUpdatePatch;
  content?: string;
}

export type UpdateIssueResult = IssueDocument;

interface UpdateIssueMutationContext {
  previousDetail?: UpdateIssueResult;
  previousLists?: Array<[QueryKey, IssueListItem[] | undefined]>;
}

/**
 * Update an issue in the active akb vault. The affected list/detail caches are
 * updated optimistically so board moves feel immediate, then invalidated after
 * the server confirms. akb is LWW so concurrent edits merge server-side per
 * field; there is no CAS-conflict dialog.
 */
export function useUpdateIssue() {
  const queryClient = useQueryClient();

  return useMutation<
    UpdateIssueResult,
    Error,
    UpdateIssueInput,
    UpdateIssueMutationContext
  >({
    mutationFn: async ({
      id,
      vault,
      patch,
      content,
    }: UpdateIssueInput): Promise<UpdateIssueResult> => {
      const res = await apiFetch(`/api/issues/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vault,
          update: {
            issue_id: id,
            patch,
            ...(content !== undefined ? { content } : {}),
          },
        }),
      });
      if (!res.ok) {
        await throwHttpError(res, `Update failed: ${res.status}`);
      }
      return res.json() as Promise<UpdateIssueResult>;
    },
    onMutate: async ({ id, vault, patch, content }) => {
      const listKey = ["issues", "list", vault] as const;
      const detailKey = ["issues", "detail", vault, id] as const;

      await Promise.all([
        queryClient.cancelQueries({ queryKey: listKey }),
        queryClient.cancelQueries({ queryKey: detailKey }),
      ]);

      // Snapshot + optimistically update every list cache for the vault — the
      // unfiltered list and any server-filtered/sorted
      // `['issues','list',vault,<query>]` variant — so the change is immediate
      // in whichever view is visible.
      const previousLists = queryClient.getQueriesData<IssueListItem[]>({
        queryKey: listKey,
      });
      const previousDetail =
        queryClient.getQueryData<UpdateIssueResult>(detailKey);

      queryClient.setQueriesData<IssueListItem[]>(
        { queryKey: listKey },
        (current) =>
          current?.map((issue) =>
            issue.id === id ? toListItem({ ...issue, ...patch }) : issue,
          ),
      );

      queryClient.setQueryData<UpdateIssueResult>(detailKey, (current) =>
        current
          ? {
              issue: { ...current.issue, ...patch },
              content: content ?? current.content,
            }
          : current,
      );

      return { previousDetail, previousLists };
    },
    onError: (_err, { id, vault }, context) => {
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) {
          queryClient.setQueryData(key, data);
        }
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(
          ["issues", "detail", vault, id],
          context.previousDetail,
        );
      }
    },
    onSuccess: (data, { id, vault }) => {
      queryClient.setQueryData(["issues", "detail", vault, id], data);
      queryClient.setQueriesData<IssueListItem[]>(
        { queryKey: ["issues", "list", vault] },
        (current) =>
          current?.map((issue) =>
            issue.id === id ? toListItem(data.issue) : issue,
          ),
      );
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

function toListItem(issue: IssueMetadata): IssueListItem {
  const {
    source: _source,
    external_refs: _externalRefs,
    implementation_refs: _implementationRefs,
    watchers: _watchers,
    reviewers: _reviewers,
    qa_owner: _qaOwner,
    custom_fields: _customFields,
    ...item
  } = issue;
  return item;
}
