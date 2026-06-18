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
import { activityKey } from "../queries/useActivity";

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
 *
 * Row-only scalar edits (status, priority, dates, ...) stay last-write-wins,
 * merged server-side per field. Document-projected edits (body/title/labels/
 * relations) carry the cached `commit_hash` as akb's `expected_commit`
 * precondition (REEF-227): a concurrent external edit is rejected with a 409
 * instead of silently overwritten. On that 409 the detail is refetched so the
 * editor reconciles to the latest, and the autosave machine surfaces the
 * conflict as a non-retry notice (never a blind retry of the stale edit), so the
 * change that won cannot be clobbered; the user re-applies against the refreshed
 * form.
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
      // OCC base (REEF-227): the document commit the open editor is showing,
      // read from the detail cache — the form's own render source. In a stale
      // window (the cache never refetched after an external edit) this is the
      // stale base, so akb rejects the write rather than overwriting. Sequential
      // autosaves stay self-consistent: onSuccess advances the cached commit
      // before the next commit's mutationFn reads it. Omitted when absent so the
      // edit degrades to last-write-wins.
      const baseCommit = queryClient.getQueryData<UpdateIssueResult>([
        "issues",
        "detail",
        vault,
        id,
      ])?.commit_hash;
      const res = await apiFetch(`/api/issues/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vault,
          update: {
            issue_id: id,
            patch,
            ...(content !== undefined ? { content } : {}),
            ...(baseCommit ? { expected_commit: baseCommit } : {}),
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

      // Spread `current` so `commit_hash` (the OCC base) survives the optimistic
      // patch — mutationFn reads it back as expected_commit (REEF-227).
      queryClient.setQueryData<UpdateIssueResult>(detailKey, (current) =>
        current
          ? {
              ...current,
              issue: { ...current.issue, ...patch },
              content: content ?? current.content,
            }
          : current,
      );

      return { previousDetail, previousLists };
    },
    onError: (err, { id, vault }, context) => {
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
      // Save conflict (REEF-227 document OCC): the cached commit the form held
      // was stale. Refetch the detail so the editor re-reads the latest body +
      // commit and the 3-way form sync pulls in the external change. The autosave
      // machine surfaces this 409 as a non-retry notice (not a blind retry of the
      // stale edit), so the change that won is not silently clobbered; the user
      // re-applies against the refreshed form. Fires only on 409 — a rare
      // exceptional path — so it does not reintroduce the post-success
      // invalidation REEF-097/098 removed.
      if ((err as { status?: number }).status === 409) {
        void queryClient.invalidateQueries({
          queryKey: ["issues", "detail", vault, id],
        });
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
      // A status change appends a `reef_activity` event server-side
      // (best-effort, REEF-063). Refetch the issue's activity query so the
      // unified timeline shows the actual logged from→to transition immediately,
      // instead of only the reconstructed current-status fallback until the
      // stale window elapses (REEF-064).
      if (patch.status !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: activityKey(vault, id),
        });
      }
    },
  });
}
