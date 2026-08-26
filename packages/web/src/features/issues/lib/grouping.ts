import {
  type IssueListItem,
  type Priority,
  type Status,
  isResolvedStatus,
} from "@reef/core";
import { PRIORITY_OPTIONS, WORKFLOW_STATUS_OPTIONS } from "@reef/core/fields";
import type { IssueGroupBy } from "./groupBy";

export type IssueGroupPatchField =
  | "status"
  | "priority"
  | "assigned_to"
  | "sprint_id"
  | "labels"
  | null;

export interface IssueGroupBucket {
  groupBy: IssueGroupBy;
  id: string;
  label: string;
  value: string | null;
  order: number;
  patchField: IssueGroupPatchField;
  patchValue: string | null;
  multiBucket: boolean;
  droppable: boolean;
}

export interface IssueGroup {
  bucket: IssueGroupBucket;
  issues: IssueListItem[];
}

export type StatusHierarchyFallback =
  | "parent_not_visible"
  | "missing_parent"
  | "non_epic_parent"
  | "deeper_chain";

export interface StatusEpicLane {
  epic: IssueListItem;
  children: IssueGroup[];
  totalChildren: number;
  completedChildren: number;
  statusCounts: Partial<Record<Status, number>>;
}

export interface StatusHierarchyProjection {
  rootGroups: IssueGroup[];
  epicLanes: StatusEpicLane[];
  fallbackByIssueId: ReadonlyMap<string, StatusHierarchyFallback>;
}

export interface IssueGroupLabels {
  none: string;
  status: Partial<Record<Status, string>>;
  priority: Partial<Record<Priority, string>>;
}

export interface IssueGroupDescriptorOptions {
  labels: IssueGroupLabels;
  assigneeNames?: Readonly<Record<string, string>>;
  sprintNames?: Readonly<Record<string, string>>;
}

export interface IssueGroupDescriptor {
  readonly groupBy: IssueGroupBy;
  bucketsForIssue(issue: IssueListItem): IssueGroupBucket[];
  bucketsForIssues(issues: readonly IssueListItem[]): IssueGroup[];
}

function compareDisplayNames(a: string, b: string): number {
  return (
    a.localeCompare(b, undefined, { sensitivity: "base" }) || a.localeCompare(b)
  );
}

function bucketId(groupBy: IssueGroupBy, value: string | null): string {
  if (groupBy === "status") return value ?? "none";
  return `${groupBy}:${value === null ? "none" : encodeURIComponent(value)}`;
}

export function statusEpicOccurrenceKey(epicId: string): string {
  return `epic:${encodeURIComponent(epicId)}`;
}

export function statusEpicBucketId(epicId: string, bucketId: string): string {
  return `${statusEpicOccurrenceKey(epicId)}:${bucketId}`;
}

function createBucket(
  groupBy: IssueGroupBy,
  label: string,
  value: string | null,
  order: number,
): IssueGroupBucket {
  const patchField: IssueGroupPatchField =
    groupBy === "status"
      ? "status"
      : groupBy === "priority"
        ? "priority"
        : groupBy === "assignee"
          ? "assigned_to"
          : groupBy === "sprint"
            ? "sprint_id"
            : groupBy === "label"
              ? "labels"
              : null;

  return {
    groupBy,
    id: bucketId(groupBy, value),
    label,
    value,
    order,
    patchField,
    patchValue: value,
    multiBucket: groupBy === "label",
    droppable:
      groupBy !== "label" &&
      groupBy !== "none" &&
      (groupBy === "priority" ||
        groupBy === "assignee" ||
        groupBy === "sprint" ||
        (groupBy === "status" && value !== null)),
  };
}

function issueValues(issue: IssueListItem, groupBy: IssueGroupBy): string[] {
  if (groupBy === "label") {
    return Array.from(
      new Set(
        (issue.labels ?? [])
          .map((label) => label.trim())
          .filter((label) => label.length > 0),
      ),
    );
  }

  const value =
    groupBy === "status"
      ? issue.status
      : groupBy === "priority"
        ? issue.priority
        : groupBy === "assignee"
          ? issue.assigned_to
          : groupBy === "sprint"
            ? issue.sprint_id
            : null;
  return value ? [value] : [];
}

function buildBuckets(
  groupBy: IssueGroupBy,
  issues: readonly IssueListItem[],
  options: IssueGroupDescriptorOptions,
): IssueGroupBucket[] {
  if (groupBy === "none") {
    return [createBucket(groupBy, options.labels.none, null, 0)];
  }

  if (groupBy === "status") {
    return WORKFLOW_STATUS_OPTIONS.map((status, order) =>
      createBucket(
        groupBy,
        options.labels.status[status] ?? status,
        status,
        order,
      ),
    );
  }

  if (groupBy === "priority") {
    return [
      ...PRIORITY_OPTIONS.map((priority, order) =>
        createBucket(
          groupBy,
          options.labels.priority[priority] ?? priority,
          priority,
          order,
        ),
      ),
      createBucket(groupBy, options.labels.none, null, PRIORITY_OPTIONS.length),
    ];
  }

  const values = new Set<string>();
  for (const issue of issues) {
    for (const value of issueValues(issue, groupBy)) values.add(value);
  }

  const displayName = (value: string) => {
    if (groupBy === "assignee") {
      return options.assigneeNames?.[value] ?? value;
    }
    if (groupBy === "sprint") {
      return options.sprintNames?.[value] ?? value;
    }
    return value;
  };
  const sortedValues = [...values].sort((a, b) =>
    compareDisplayNames(displayName(a), displayName(b)),
  );

  return [
    ...sortedValues.map((value, order) =>
      createBucket(groupBy, displayName(value), value, order),
    ),
    createBucket(groupBy, options.labels.none, null, sortedValues.length),
  ];
}

function sameGroupValue(
  issue: IssueListItem,
  groupBy: IssueGroupBy,
  value: string | null,
): boolean {
  if (groupBy === "label") {
    const values = issueValues(issue, groupBy);
    return value === null ? values.length === 0 : values.includes(value);
  }
  return (issueValues(issue, groupBy)[0] ?? null) === value;
}

export function createIssueGroupDescriptor(
  groupBy: IssueGroupBy,
  options: IssueGroupDescriptorOptions,
): IssueGroupDescriptor {
  return {
    groupBy,
    bucketsForIssue(issue) {
      const buckets = buildBuckets(groupBy, [issue], options);
      return buckets.filter((bucket) =>
        sameGroupValue(issue, groupBy, bucket.value),
      );
    },
    bucketsForIssues(issues) {
      const buckets = buildBuckets(groupBy, issues, options);
      const issueByBucket = new Map(
        buckets.map((bucket) => [bucket.id, [] as IssueListItem[]]),
      );

      for (const issue of issues) {
        for (const bucket of buckets) {
          if (sameGroupValue(issue, groupBy, bucket.value)) {
            issueByBucket.get(bucket.id)?.push(issue);
          }
        }
      }

      return buckets.map((bucket) => ({
        bucket,
        issues: issueByBucket.get(bucket.id) ?? [],
      }));
    },
  };
}

export function groupIssues(
  issues: readonly IssueListItem[],
  descriptor: IssueGroupDescriptor,
): IssueGroup[] {
  return descriptor.bucketsForIssues(issues);
}

/**
 * Project the Status board's flat groups into one-level epic lanes. The input
 * is already filtered and sorted, so a parent is eligible for nesting only
 * when that same parent is visible in the current board scope. This keeps
 * filtered-out parents and unsupported relationships actionable as ordinary
 * cards without changing board membership. `allIssues` distinguishes a
 * filtered-out parent from a genuinely missing parent when callers have the
 * wider issue collection available.
 */
export function projectStatusHierarchy(
  groups: readonly IssueGroup[],
  visibleIssues: readonly IssueListItem[],
  allIssues: readonly IssueListItem[] = visibleIssues,
): StatusHierarchyProjection {
  const visibleById = new Map(
    visibleIssues.map((issue) => [issue.id, issue] as const),
  );
  const allById = new Set(allIssues.map((issue) => issue.id));
  const laneEpics = visibleIssues.filter(
    (issue) => issue.issue_type === "epic" && issue.parent_id == null,
  );
  const laneIds = new Set(laneEpics.map((issue) => issue.id));
  const nestedIds = new Set<string>();
  const directChildrenByEpic = new Map<string, Map<Status, IssueListItem[]>>();

  for (const issue of visibleIssues) {
    if (issue.parent_id && laneIds.has(issue.parent_id)) {
      nestedIds.add(issue.id);
      const byStatus =
        directChildrenByEpic.get(issue.parent_id) ??
        new Map<Status, IssueListItem[]>();
      const children = byStatus.get(issue.status) ?? [];
      children.push(issue);
      byStatus.set(issue.status, children);
      directChildrenByEpic.set(issue.parent_id, byStatus);
    }
  }

  const fallbackByIssueId = new Map<string, StatusHierarchyFallback>();
  for (const issue of visibleIssues) {
    if (!issue.parent_id || nestedIds.has(issue.id)) continue;

    const parent = visibleById.get(issue.parent_id);
    if (!parent) {
      fallbackByIssueId.set(
        issue.id,
        allById.has(issue.parent_id) ? "parent_not_visible" : "missing_parent",
      );
    } else if (parent.parent_id != null) {
      fallbackByIssueId.set(issue.id, "deeper_chain");
    } else {
      fallbackByIssueId.set(issue.id, "non_epic_parent");
    }
  }

  const rootGroups = groups.map(({ bucket, issues }) => ({
    bucket,
    issues: issues.filter(
      (issue) => !laneIds.has(issue.id) && !nestedIds.has(issue.id),
    ),
  }));

  const epicLanes = laneEpics.map((epic) => {
    const children = groups.map(({ bucket }) => ({
      bucket: {
        ...bucket,
        id: statusEpicBucketId(epic.id, bucket.id),
      },
      issues: bucket.value
        ? (directChildrenByEpic.get(epic.id)?.get(bucket.value as Status) ?? [])
        : [],
    }));
    const laneChildren = children.flatMap(({ issues }) => issues);
    const statusCounts: Partial<Record<Status, number>> = {};
    for (const child of laneChildren) {
      statusCounts[child.status] = (statusCounts[child.status] ?? 0) + 1;
    }

    return {
      epic,
      children,
      totalChildren: laneChildren.length,
      completedChildren: laneChildren.filter((child) =>
        isResolvedStatus(child.status),
      ).length,
      statusCounts,
    };
  });

  return { rootGroups, epicLanes, fallbackByIssueId };
}
