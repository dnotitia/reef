import {
  isResolvedStatus,
  type IssueListItem,
  type IssueRelation,
  type Priority,
  type Status,
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

export interface IssueGroupProgress {
  done: number;
  total: number;
}

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
  /** Root Epic metadata for an `epic` bucket; absent for fallback buckets. */
  epic?: IssueRelation;
  /** Visible direct-child completion, with `done` including closed issues. */
  progress?: IssueGroupProgress;
}

export interface IssueGroup {
  bucket: IssueGroupBucket;
  issues: IssueListItem[];
}

export interface IssueGroupLabels {
  none: string;
  status: Partial<Record<Status, string>>;
  priority: Partial<Record<Priority, string>>;
  epic?: {
    none: string;
    unavailableParent: string;
  };
}

export interface IssueGroupDescriptorOptions {
  labels: IssueGroupLabels;
  assigneeNames?: Readonly<Record<string, string>>;
  sprintNames?: Readonly<Record<string, string>>;
  /** Whole-vault compact relation projection used to resolve filtered parents. */
  hierarchyCatalog?: readonly IssueRelation[];
  locale?: string;
}

export interface IssueGroupDescriptor {
  readonly groupBy: IssueGroupBy;
  bucketsForIssues(issues: readonly IssueListItem[]): IssueGroup[];
}

function compareDisplayNames(a: string, b: string, locale?: string): number {
  return (
    a.localeCompare(b, locale, { sensitivity: "base" }) ||
    a.localeCompare(b, locale)
  );
}

function bucketId(groupBy: IssueGroupBy, value: string | null): string {
  if (groupBy === "status") return value ?? "none";
  return `${groupBy}:${value === null ? "none" : encodeURIComponent(value)}`;
}

function issueToRelation(issue: IssueListItem): IssueRelation {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    issue_type: issue.issue_type ?? "task",
    parent_id: issue.parent_id ?? null,
    rank:
      typeof issue.rank === "number" && Number.isFinite(issue.rank)
        ? issue.rank
        : null,
    depends_on: issue.depends_on ?? [],
  };
}

/**
 * Merge the whole-vault compact projection with the currently loaded issue
 * rows. The latter wins for overlapping ids so optimistic status/title/parent
 * edits are reflected immediately, while catalog-only parents remain
 * available when a filter removed them from the visible list.
 */
export function buildIssueHierarchyCatalog(
  relations: readonly IssueRelation[] | undefined,
  issues: readonly IssueListItem[],
): IssueRelation[] {
  const catalog = new Map<string, IssueRelation>();
  for (const relation of relations ?? []) catalog.set(relation.id, relation);
  for (const issue of issues) {
    const existing = catalog.get(issue.id);
    const current = issueToRelation(issue);
    catalog.set(issue.id, {
      ...current,
      issue_type:
        issue.issue_type ?? existing?.issue_type ?? current.issue_type,
      parent_id:
        issue.parent_id !== undefined
          ? issue.parent_id
          : (existing?.parent_id ?? current.parent_id),
      rank:
        typeof issue.rank === "number" && Number.isFinite(issue.rank)
          ? issue.rank
          : (existing?.rank ?? current.rank),
      depends_on: issue.depends_on ?? existing?.depends_on ?? [],
    });
  }
  return [...catalog.values()];
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
    compareDisplayNames(displayName(a), displayName(b), options.locale),
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

function isRootEpic(node: IssueRelation | undefined): node is IssueRelation {
  return node?.issue_type === "epic" && node.parent_id === null;
}

function compareEpicNodes(
  a: IssueRelation,
  b: IssueRelation,
  locale?: string,
): number {
  const aRank = a.rank;
  const bRank = b.rank;
  if (aRank !== bRank) {
    if (aRank === null) return 1;
    if (bRank === null) return -1;
    return aRank - bRank;
  }
  return (
    compareDisplayNames(a.title, b.title, locale) ||
    compareDisplayNames(a.id, b.id, locale)
  );
}

function createEpicFallbackBucket(
  fallback: "no_epic" | "unavailable_parent",
  labels: IssueGroupLabels,
  order: number,
): IssueGroupBucket {
  const label =
    fallback === "no_epic"
      ? (labels.epic?.none ?? labels.none)
      : (labels.epic?.unavailableParent ?? labels.none);
  return {
    ...createBucket(
      "epic",
      label,
      fallback === "no_epic" ? null : "unavailable-parent",
      order,
    ),
  };
}

function buildEpicGroups(
  issues: readonly IssueListItem[],
  options: IssueGroupDescriptorOptions,
): IssueGroup[] {
  const catalog = new Map(
    buildIssueHierarchyCatalog(options.hierarchyCatalog, issues).map((node) => [
      node.id,
      node,
    ]),
  );
  const rootIds = new Set<string>();
  const childrenByRoot = new Map<string, IssueListItem[]>();
  const noEpic: IssueListItem[] = [];
  const unavailableParent: IssueListItem[] = [];

  for (const issue of issues) {
    const issueNode = catalog.get(issue.id);
    if (isRootEpic(issueNode)) {
      // A root Epic is a header occurrence only; it must never become its own
      // child row/card.
      rootIds.add(issueNode.id);
      continue;
    }

    const parentId = issue.parent_id ?? null;
    if (parentId === null) {
      noEpic.push(issue);
      continue;
    }

    const parent = catalog.get(parentId);
    if (!parent) {
      unavailableParent.push(issue);
      continue;
    }
    if (!isRootEpic(parent)) {
      // Non-Epic parents and nested/deeper parent chains are intentionally one
      // flat fallback; do not recursively walk the hierarchy.
      noEpic.push(issue);
      continue;
    }

    rootIds.add(parent.id);
    const children = childrenByRoot.get(parent.id) ?? [];
    children.push(issue);
    childrenByRoot.set(parent.id, children);
  }

  const rootEpics = [...rootIds]
    .map((id) => catalog.get(id))
    .filter((node): node is IssueRelation => isRootEpic(node))
    .sort((a, b) => compareEpicNodes(a, b, options.locale));
  const groups: IssueGroup[] = rootEpics.map((epic, order) => {
    const children = childrenByRoot.get(epic.id) ?? [];
    return {
      bucket: {
        ...createBucket("epic", epic.title, epic.id, order),
        epic,
        progress: {
          done: children.filter((child) => isResolvedStatus(child.status))
            .length,
          total: children.length,
        },
      },
      issues: children,
    };
  });

  if (noEpic.length > 0) {
    groups.push({
      bucket: createEpicFallbackBucket(
        "no_epic",
        options.labels,
        groups.length,
      ),
      issues: noEpic,
    });
  }
  if (unavailableParent.length > 0) {
    groups.push({
      bucket: createEpicFallbackBucket(
        "unavailable_parent",
        options.labels,
        groups.length,
      ),
      issues: unavailableParent,
    });
  }
  return groups;
}

export function createIssueGroupDescriptor(
  groupBy: IssueGroupBy,
  options: IssueGroupDescriptorOptions,
): IssueGroupDescriptor {
  return {
    groupBy,
    bucketsForIssues(issues) {
      if (groupBy === "epic") return buildEpicGroups(issues, options);
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
