import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useWorkflowStatusGuard } from "@/features/issues/hooks/view/useWorkflowStatusGuard";
import {
  buildIssueQuery,
  buildManualIssueQuery,
} from "@/features/issues/lib/buildIssueQuery";
import type { IssueScope } from "@/features/issues/lib/viewMode";
import {
  isManualOrdering,
  useIssueStore,
} from "@/features/issues/stores/useIssueStore";
import { useEffect, useMemo, useRef } from "react";

export function useBoardIssueList({
  vault,
  scope = "active",
  fixedSprintId,
  enabled = true,
}: {
  vault: string;
  scope?: IssueScope;
  fixedSprintId?: string;
  enabled?: boolean;
}) {
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const workflowStatusReady = useWorkflowStatusGuard(
    enabled && scope === "active",
  );
  const query = useMemo(
    () =>
      isManualOrdering(filter)
        ? buildManualIssueQuery(filter, scope, fixedSprintId)
        : buildIssueQuery(filter, searchQuery, scope, fixedSprintId),
    [filter, fixedSprintId, scope, searchQuery],
  );
  const issueList = useIssueList(vault, query, {
    enabled: enabled && workflowStatusReady,
  });
  const { isPending, isFetching, isPlaceholderData } = issueList;
  const settledSearchQuery = useRef(searchQuery);
  useEffect(() => {
    if (!isPending && !isFetching && !isPlaceholderData) {
      settledSearchQuery.current = searchQuery;
    }
  }, [isPending, isFetching, isPlaceholderData, searchQuery]);

  return {
    issueList,
    displaySearchQuery: isPlaceholderData
      ? settledSearchQuery.current
      : searchQuery,
  };
}
