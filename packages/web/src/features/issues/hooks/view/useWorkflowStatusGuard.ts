"use client";

import { WORKFLOW_STATUS_OPTIONS } from "@/components/ui/status-icon";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { useEffect } from "react";

const WORKFLOW_STATUS_SET: ReadonlySet<string> = new Set(
  WORKFLOW_STATUS_OPTIONS,
);

/**
 * Keep the shared status filter compatible with a workflow view (board /
 * timeline). Those views group issues by `WORKFLOW_STATUS_OPTIONS` and have no
 * `backlog` column, so a `backlog` status filter — carried over from the list
 * view or arriving via a shared URL — would blank them with a chip the status
 * menu no longer offers (REEF-109). Call this from a component that just mounts
 * in a workflow view; it strips any non-workflow status from `filter.status`
 * (clearing the facet if nothing workflow-compatible remains).
 *
 * Converges in one pass: after the strip, `filter.status` changes and the effect
 * re-runs with nothing left to remove. The list view does not use this guard, so
 * it keeps the full status set.
 */
export function useWorkflowStatusGuard(): void {
  const status = useIssueStore((state) => state.filter.status);
  const setFilter = useIssueStore((state) => state.setFilter);

  useEffect(() => {
    if (!status?.length) return;
    const allowed = status.filter((s) => WORKFLOW_STATUS_SET.has(s));
    if (allowed.length !== status.length) {
      setFilter({ status: allowed.length ? allowed : undefined });
    }
  }, [status, setFilter]);
}
