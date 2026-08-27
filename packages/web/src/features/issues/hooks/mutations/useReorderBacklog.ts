"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  IssueReorderResponseSchema,
  type IssueListItem,
  type IssueReorderGroup,
} from "@reef/core";
import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  restoreIssueListCacheItems,
  updateIssueListCaches,
} from "../../lib/issueListCache";
import { reorderListInvalidationPredicate } from "../../lib/issueListMembership";
import type {
  IssueReorderGroupInput,
  IssueReorderTarget,
} from "../../lib/issueReorder";

export interface ReorderIssueInput extends IssueReorderTarget {
  vault: string;
  scope: "active" | "backlog";
  group?: IssueReorderGroupInput;
}

interface ReorderIssueContext {
  previousLists: Array<[QueryKey, unknown]>;
}

async function invalidateReorderQueries(
  queryClient: QueryClient,
  input: ReorderIssueInput,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: ["issues", "list", input.vault],
    predicate: reorderListInvalidationPredicate(input.group),
    refetchType: "all",
  });
  if (input.group?.field === "status") {
    await queryClient.invalidateQueries({
      queryKey: ["issues", "relations", input.vault],
      refetchType: "all",
    });
  }
}

function optimisticRank(input: ReorderIssueInput): number {
  const before = input.expected.beforeRank;
  const after = input.expected.afterRank;
  if (before != null && after != null && after > before) {
    const midpoint = before + (after - before) / 2;
    if (midpoint > before && midpoint < after) return midpoint;
  }
  if (before != null) return before + 1000;
  if (after != null) return after - 1000;
  return 1000;
}

function applyGroup(
  issue: IssueListItem,
  group: IssueReorderGroup,
): IssueListItem {
  switch (group.field) {
    case "status":
      return {
        ...issue,
        status: group.value as IssueListItem["status"],
        ...(group.value === "closed"
          ? { closed_reason: group.closed_reason ?? null }
          : { closed_at: null, closed_reason: null }),
      };
    case "priority":
      return { ...issue, priority: group.value as IssueListItem["priority"] };
    case "assigned_to":
      return { ...issue, assigned_to: group.value };
    case "sprint_id":
      return { ...issue, sprint_id: group.value };
  }
}

function mapOptimisticIssue(
  issue: IssueListItem,
  input: ReorderIssueInput,
  rankById: ReadonlyMap<
    string,
    { rank: number; updatedAt?: string }
  > = new Map(),
  settledRank: number | null | undefined,
): IssueListItem {
  let next = issue;
  const persisted = rankById.get(issue.id);
  const rank =
    persisted?.rank ??
    (issue.id === input.issueId
      ? settledRank !== undefined
        ? settledRank
        : optimisticRank(input)
      : undefined);
  if (rank !== undefined) {
    next = {
      ...next,
      rank,
      ...(persisted?.updatedAt ? { updated_at: persisted.updatedAt } : {}),
    };
  }
  if (input.group && issue.id === input.issueId) {
    next = applyGroup(next, input.group);
  }
  return next;
}

function requestBody(input: ReorderIssueInput): Record<string, unknown> {
  return {
    vault: input.vault,
    scope: input.scope,
    issue_id: input.issueId,
    before_id: input.beforeId,
    after_id: input.afterId,
    expected: {
      issue_rank: input.expected.issueRank,
      issue_updated_at: input.expected.issueUpdatedAt,
      before_rank: input.expected.beforeRank,
      before_updated_at: input.expected.beforeUpdatedAt,
      after_rank: input.expected.afterRank,
      after_updated_at: input.expected.afterUpdatedAt,
    },
    ...(input.group ? { group: input.group } : {}),
  };
}

/**
 * Persist a Manual-order move for any supported issue surface. The browser
 * optimistically changes only the moved entity's rank; the server response
 * supplies any additional materialized ranks, so no client-owned id sequence
 * is introduced.
 */
export function useReorderBacklog() {
  const queryClient = useQueryClient();

  return useMutation<
    ReturnType<typeof IssueReorderResponseSchema.parse>,
    Error,
    ReorderIssueInput,
    ReorderIssueContext
  >({
    mutationFn: async (input) => {
      const res = await apiFetch("/api/issues/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody(input)),
      });
      if (!res.ok) {
        await throwHttpError(res, `Reorder failed: ${res.status}`);
      }
      return IssueReorderResponseSchema.parse(await res.json());
    },
    onMutate: async (input) => {
      const listKey = ["issues", "list", input.vault] as const;
      await queryClient.cancelQueries({ queryKey: listKey });
      const previousLists = updateIssueListCaches(
        queryClient,
        input.vault,
        (issue) => mapOptimisticIssue(issue, input, new Map(), undefined),
      );
      return { previousLists };
    },
    onError: async (_error, input, context) => {
      if (context?.previousLists) {
        restoreIssueListCacheItems(
          queryClient,
          context.previousLists,
          input.issueId,
        );
      }
      // A rejected anchor may reflect another user's committed order. Restore
      // the local snapshot immediately, then re-read every active list cache so
      // rollback converges to the server rather than merely to stale input.
      await invalidateReorderQueries(queryClient, input);
    },
    onSuccess: (data, input) => {
      const rankById = new Map(
        data.assignments.map((assignment) => [
          assignment.id,
          { rank: assignment.rank, updatedAt: assignment.updated_at },
        ]),
      );
      updateIssueListCaches(queryClient, input.vault, (issue) =>
        mapOptimisticIssue(issue, input, rankById, input.expected.issueRank),
      );
    },
    onSettled: async (_data, error, input) => {
      if (error) return;
      await invalidateReorderQueries(queryClient, input);
    },
  });
}
