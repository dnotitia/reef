import type { IssueListItem, Priority, Status } from "@reef/core";
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
