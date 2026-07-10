// @vitest-environment node

import { buildStatusPatch } from "@/features/issues/lib/statusPatch";
import type {
  ClosedReason,
  IssueListItem,
  IssueUpdatePatch,
  Priority,
  Status,
} from "@reef/core";

export type BulkIssueOperation =
  | { kind: "status"; value: Status; closedReason?: ClosedReason }
  | { kind: "assignee"; value: string | null }
  | { kind: "priority"; value: Priority | null }
  | { kind: "sprint"; value: string | null }
  | { kind: "labels:add"; value: readonly string[] }
  | { kind: "labels:remove"; value: readonly string[] };

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function stableLabelUnion(
  current: readonly string[],
  added: readonly string[],
): string[] {
  const result = [...current];
  const seen = new Set(current.map((label) => label.toLocaleLowerCase()));
  for (const label of added) {
    const trimmed = label.trim();
    const key = trimmed.toLocaleLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

export function buildBulkIssuePatch(
  issue: IssueListItem,
  operation: BulkIssueOperation,
): IssueUpdatePatch | null {
  switch (operation.kind) {
    case "status": {
      if (issue.status === operation.value) return null;
      const patch = buildStatusPatch(
        issue,
        operation.value,
        undefined,
        operation.closedReason,
      );
      return operation.value === "backlog"
        ? { ...patch, sprint_id: null }
        : patch;
    }
    case "assignee":
      return (issue.assigned_to ?? null) === operation.value
        ? null
        : { assigned_to: operation.value };
    case "priority":
      return (issue.priority ?? null) === operation.value
        ? null
        : { priority: operation.value };
    case "sprint": {
      const current = issue.sprint_id ?? null;
      if (
        current === operation.value &&
        !(operation.value && issue.status === "backlog")
      ) {
        return null;
      }
      return operation.value && issue.status === "backlog"
        ? { sprint_id: operation.value, status: "todo" }
        : { sprint_id: operation.value };
    }
    case "labels:add": {
      const labels = stableLabelUnion(issue.labels ?? [], operation.value);
      return sameArray(labels, issue.labels ?? []) ? null : { labels };
    }
    case "labels:remove": {
      const removed = new Set(
        operation.value.map((label) => label.toLocaleLowerCase()),
      );
      const labels = (issue.labels ?? []).filter(
        (label) => !removed.has(label.toLocaleLowerCase()),
      );
      return sameArray(labels, issue.labels ?? []) ? null : { labels };
    }
  }
}

/** A stale selected id still needs a real PATCH so the Route Handler can report 404. */
export function fallbackPatchForBulkOperation(
  operation: BulkIssueOperation,
): IssueUpdatePatch {
  switch (operation.kind) {
    case "status":
      return operation.value === "closed"
        ? {
            status: operation.value,
            closed_reason: operation.closedReason ?? "completed",
          }
        : operation.value === "backlog"
          ? { status: operation.value, sprint_id: null }
          : { status: operation.value };
    case "assignee":
      return { assigned_to: operation.value };
    case "priority":
      return { priority: operation.value };
    case "sprint":
      return { sprint_id: operation.value };
    case "labels:add":
    case "labels:remove":
      return { labels: [...operation.value] };
  }
}
