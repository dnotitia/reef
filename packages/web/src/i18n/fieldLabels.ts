"use client";

/**
 * Locale-aware field-label lookup (REEF-292 / ADR-0001).
 *
 * `core` owns the message keys (the enum values) and the en base catalog as
 * pure data; here web resolves the active locale through next-intl and returns
 * the familiar `Record<Enum, string>` shape the field leaves and surfaces
 * already consume, so a call site swaps `STATUS_LABELS[status]` for
 * `useStatusLabels()[status]` and keeps its logic. Missing locale keys fall back
 * to the en base at message-merge time (`i18n/messages.ts`), so a lookup never
 * returns a hole (AC1, AC3).
 *
 * Each returned map is memoized on the active translator, so it is referentially
 * stable across renders for one locale — safe to pass as a `useMemo` dependency
 * (e.g. the reports pivot) without forcing a recompute every render. The field
 * leaves that consume these are only ever rendered inside client trees, so the
 * `"use client"` boundary here costs nothing.
 */
import type {
  ClosedReason,
  IssueType,
  Priority,
  Severity,
  Status,
} from "@reef/core";
import { USER_SORT_FIELDS } from "@reef/core";
import {
  CLOSED_REASON_OPTIONS,
  DEPENDENCY_OPTIONS,
  DUE_OPTIONS,
  type DependencyFacet,
  type DueFacet,
  ISSUE_TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  SEVERITY_OPTIONS,
  STATUS_OPTIONS,
  type SortOrder,
  type UserSortField,
} from "@reef/core/fields";
import {
  MILESTONE_STATUS_OPTIONS,
  type MilestoneStatus,
  PLANNING_KINDS,
  type PlanningKind,
  RELEASE_STATUS_OPTIONS,
  type ReleaseStatus,
  SPRINT_STATUS_OPTIONS,
  type SprintStatus,
} from "@reef/core/fields/planning";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

/**
 * Resolve every key in `keys` against `namespace` into a `Record<K, string>`.
 * The key set is a core-owned enum option array, so the result is exhaustive by
 * construction — the same guarantee the old `Record<Enum, string>` maps gave.
 */
function useLabelRecord<K extends string>(
  namespace: string,
  keys: readonly K[],
): Record<K, string> {
  // Every field label is a plain string leaf, so narrow next-intl's translator
  // to a key→string lookup. Without the optional `IntlMessages` augmentation,
  // next-intl types `t`'s rest args against the whole tree and a dynamic `t(key)`
  // reads as possibly needing ICU values; this keeps the call honest and typed.
  const t = useTranslations(namespace) as unknown as (key: string) => string;
  return useMemo(() => {
    const out = {} as Record<K, string>;
    for (const key of keys) out[key] = t(key);
    return out;
  }, [t, keys]);
}

export const useStatusLabels = (): Record<Status, string> =>
  useLabelRecord("fields.status", STATUS_OPTIONS);

export const usePriorityLabels = (): Record<Priority, string> =>
  useLabelRecord("fields.priority", PRIORITY_OPTIONS);

export const useIssueTypeLabels = (): Record<IssueType, string> =>
  useLabelRecord("fields.issueType", ISSUE_TYPE_OPTIONS);

export const useSeverityLabels = (): Record<Severity, string> =>
  useLabelRecord("fields.severity", SEVERITY_OPTIONS);

export const useClosedReasonLabels = (): Record<ClosedReason, string> =>
  useLabelRecord("fields.closedReason", CLOSED_REASON_OPTIONS);

export const useClosedReasonHints = (): Record<ClosedReason, string> =>
  useLabelRecord("fields.closedReasonHint", CLOSED_REASON_OPTIONS);

export const useDueLabels = (): Record<DueFacet, string> =>
  useLabelRecord("fields.due", DUE_OPTIONS);

export const useDependencyLabels = (): Record<DependencyFacet, string> =>
  useLabelRecord("fields.dependency", DEPENDENCY_OPTIONS);

export const useSortFieldLabels = (): Record<UserSortField, string> =>
  useLabelRecord("fields.sortField", USER_SORT_FIELDS);

/**
 * Field-aware natural-language sort direction label, keyed `{field}.{order}`
 * (e.g. "High → Low" for priority desc). Returns a resolver so a control can
 * label several fields/orders from one hook call.
 */
export function useDirectionLabel(): (
  field: UserSortField,
  order: SortOrder,
) => string {
  const t = useTranslations("fields.sortDirection") as unknown as (
    key: string,
  ) => string;
  return useMemo(
    () => (field: UserSortField, order: SortOrder) => t(`${field}.${order}`),
    [t],
  );
}

// --- Planning labels --------------------------------------------------------

export const usePlanningKindLabels = (): Record<PlanningKind, string> =>
  useLabelRecord("fields.planning.kind", PLANNING_KINDS);

export const usePlanningKindSingularLabels = (): Record<PlanningKind, string> =>
  useLabelRecord("fields.planning.kindSingular", PLANNING_KINDS);

export const useSprintStatusLabels = (): Record<SprintStatus, string> =>
  useLabelRecord("fields.planning.sprintStatus", SPRINT_STATUS_OPTIONS);

export const useMilestoneStatusLabels = (): Record<MilestoneStatus, string> =>
  useLabelRecord("fields.planning.milestoneStatus", MILESTONE_STATUS_OPTIONS);

export const useReleaseStatusLabels = (): Record<ReleaseStatus, string> =>
  useLabelRecord("fields.planning.releaseStatus", RELEASE_STATUS_OPTIONS);
