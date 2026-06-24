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
  FIELD_NAME_KEYS,
  type FieldNameKey,
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
  // This generic helper resolves any field namespace, so the runtime `namespace`
  // string can't carry next-intl's typed `NamespaceKeys` (the REEF-293 AppConfig
  // augmentation) — `as never` satisfies the namespace parameter. Each field
  // label is a plain string leaf, so the result is narrowed to a key→string
  // lookup; the concrete namespaces are exercised by `fieldLabels.test.tsx`.
  const t = useTranslations(namespace as never) as unknown as (
    key: string,
  ) => string;
  return useMemo(() => {
    const out = {} as Record<K, string>;
    for (const key of keys) out[key] = t(key);
    return out;
  }, [t, keys]);
}

/**
 * Enrichment-card empty-state placeholders ("None", "Not set"), resolved at
 * render from the `enrichment` web namespace (REEF-299). Co-located with the
 * field-label hooks so the broad component suite resolves them to the en base
 * through the same `vitest.setup` mock, without a provider in every test.
 */
export const ENRICHMENT_EMPTY_KEYS = [
  "empty",
  "unassigned",
  "none",
  "notSet",
  "noPriority",
  "noSeverity",
] as const;

export type EnrichmentEmptyKey = (typeof ENRICHMENT_EMPTY_KEYS)[number];

export const useEnrichmentEmptyLabels = (): Record<
  EnrichmentEmptyKey,
  string
> => useLabelRecord("enrichment", ENRICHMENT_EMPTY_KEYS);

export const useStatusLabels = (): Record<Status, string> =>
  useLabelRecord("fields.status", STATUS_OPTIONS);

export const usePriorityLabels = (): Record<Priority, string> =>
  useLabelRecord("fields.priority", PRIORITY_OPTIONS);

export const useIssueTypeLabels = (): Record<IssueType, string> =>
  useLabelRecord("fields.issueType", ISSUE_TYPE_OPTIONS);

export const useSeverityLabels = (): Record<Severity, string> =>
  useLabelRecord("fields.severity", SEVERITY_OPTIONS);

/**
 * Field-NAME labels keyed by field id ("assignee" → "Assignee"/"담당자"),
 * distinct from the field-VALUE hooks above. One shared source for the header
 * words the issue rail, filter bar, report scope bar, create dialog, and
 * activity draft editor render, so a field's name is localized alongside its
 * already-localized values (REEF-301 / REEF-298 AC2/AC4).
 */
export const useFieldNameLabels = (): Record<FieldNameKey, string> =>
  useLabelRecord("fields.name", FIELD_NAME_KEYS);

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
