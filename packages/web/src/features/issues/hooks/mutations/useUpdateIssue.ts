"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type {
  IssueDocument,
  IssueListItem,
  IssueUpdatePatch,
} from "@reef/core";
import {
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  listQueryHasFreeText,
  patchAffectsListMembership,
  patchAffectsRelationGraph,
} from "../../lib/issueListMembership";
import { toListItem } from "../../lib/toListItem";

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
 * patched optimistically so board moves feel immediate, then overwritten with
 * the server response on success, avoiding blanket invalidation (REEF-098). The
 * caches stay the fresh server truth in place, and membership/order or
 * relation-graph changes trigger a narrow refetch (see `issueListMembership`).
 * akb is LWW so concurrent edits merge server-side per field; there is no
 * CAS-conflict dialog.
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
    onSuccess: (data, { id, vault, patch }) => {
      const item = toListItem(data.issue);
      // The server response is authoritative — write it straight into the
      // detail and every list-variant cache (ref-preserving for unchanged
      // rows). This keeps the whole-set consumers (board, backlog, reports,
      // timeline, search) fresh with no re-request, and the entity-store
      // normalizer mirrors the patched item into the store so the migrated
      // list rows update granularly.
      queryClient.setQueryData(["issues", "detail", vault, id], data);
      queryClient.setQueriesData<IssueListItem[]>(
        { queryKey: ["issues", "list", vault] },
        (current) => current?.map((issue) => (issue.id === id ? item : issue)),
      );

      // Avoid blanket invalidation (REEF-098). A non-membership edit (title,
      // dates, labels, ...) needs no re-request: the in-place patch above is the
      // server truth. Refetch the projections an edit can invalidate.
      if (patchAffectsListMembership(patch)) {
        // A server facet or the sort field changed → the issue may move, leave,
        // or enter a filtered/sorted list; refetch every variant to reconcile.
        void queryClient.invalidateQueries({
          queryKey: ["issues", "list", vault],
        });
      } else {
        // A free-text (`q`) search matches title/assignee/etc., so a content
        // edit can change its membership unpredictably: refetch the active
        // q-filtered variants; plain/facet lists stay patched.
        void queryClient.invalidateQueries({
          queryKey: ["issues", "list", vault],
          predicate: listQueryHasFreeText,
        });
      }
      if (patchAffectsRelationGraph(patch)) {
        void queryClient.invalidateQueries({
          queryKey: ["issues", "relations", vault],
        });
      }
    },
  });
}
