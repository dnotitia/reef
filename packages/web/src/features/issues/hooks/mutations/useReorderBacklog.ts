"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  type IssueListItem,
  type RankedItem,
  computeReorderedRanks,
} from "@reef/core";
import {
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

interface ReorderBacklogInput {
  vault: string;
  /** The backlog in its current display order, so `from`/`to` index into it. */
  ordered: readonly IssueListItem[];
  fromIndex: number;
  toIndex: number;
}

interface ReorderBacklogContext {
  previousLists: Array<[QueryKey, IssueListItem[] | undefined]>;
}

function toRankedItems(ordered: readonly IssueListItem[]): RankedItem[] {
  return ordered.map((issue) => ({ id: issue.id, rank: issue.rank ?? null }));
}

/**
 * Persist a backlog drag-reorder as `rank` writes (REEF-129). The pure
 * `computeReorderedRanks` algebra decides the minimal set of rows to touch —
 * one in the steady state, a bounded run / curated re-space otherwise. They are
 * sent as a SINGLE atomic request so a multi-row reorder does not lands partially;
 * `rank` is a row column, not a document field, so no commit churns.
 *
 * The display order in the backlog view is a pure function of `rank`
 * (`backlogRankSortKey`), so the optimistic update just has to stamp the new
 * ranks onto the affected rows in every list cache for the vault; the view
 * re-sorts itself.
 */
export function useReorderBacklog() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ReorderBacklogInput, ReorderBacklogContext>({
    mutationFn: async ({ vault, ordered, fromIndex, toIndex }) => {
      const updates = computeReorderedRanks(
        toRankedItems(ordered),
        fromIndex,
        toIndex,
      );
      if (updates.length === 0) return;
      const res = await apiFetch("/api/issues/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vault, assignments: updates }),
      });
      if (!res.ok) {
        await throwHttpError(res, `Reorder failed: ${res.status}`);
      }
    },
    onMutate: async ({ vault, ordered, fromIndex, toIndex }) => {
      const listKey = ["issues", "list", vault] as const;
      await queryClient.cancelQueries({ queryKey: listKey });

      const previousLists = queryClient.getQueriesData<IssueListItem[]>({
        queryKey: listKey,
      });

      const updates = computeReorderedRanks(
        toRankedItems(ordered),
        fromIndex,
        toIndex,
      );
      const rankById = new Map(updates.map((u) => [u.id, u.rank]));

      // Stamp the new ranks onto every list cache for the vault; the backlog
      // view re-sorts by rank, so this is the whole optimistic reorder.
      queryClient.setQueriesData<IssueListItem[]>(
        { queryKey: listKey },
        (current) =>
          current?.map((issue) =>
            rankById.has(issue.id)
              ? { ...issue, rank: rankById.get(issue.id) }
              : issue,
          ),
      );

      return { previousLists };
    },
    onError: (_err, _input, context) => {
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: (_data, _err, { vault }) => {
      void queryClient.invalidateQueries({
        queryKey: ["issues", "list", vault],
      });
    },
  });
}
