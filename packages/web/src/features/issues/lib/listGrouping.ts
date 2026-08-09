import type { IssueListItem } from "@reef/core";
import type { IssueGroup, IssueGroupBucket } from "./grouping";

export interface IssueListGroupHeaderItem {
  kind: "header";
  key: string;
  bucket: IssueGroupBucket;
  count: number;
  collapsed: boolean;
}

export interface IssueListGroupRowItem {
  kind: "issue";
  key: string;
  occurrenceKey: string;
  bucket: IssueGroupBucket;
  issue: IssueListItem;
}

export type IssueListVirtualItem =
  | IssueListGroupHeaderItem
  | IssueListGroupRowItem;

/**
 * Builds the single logical projection consumed by TanStack Virtual. Group
 * headers and issue rows therefore share one virtual count; a collapsed
 * bucket keeps its header and count but contributes no rows to the model.
 */
export function buildIssueListVirtualItems(
  groups: readonly IssueGroup[],
  collapsedBucketIds: ReadonlySet<string>,
): IssueListVirtualItem[] {
  const firstBucket = groups[0]?.bucket;
  if (firstBucket?.groupBy === "none") {
    return groups.flatMap(({ issues }) =>
      issues.map((issue) => ({
        kind: "issue" as const,
        key: issue.id,
        occurrenceKey: issue.id,
        bucket: firstBucket,
        issue,
      })),
    );
  }

  const items: IssueListVirtualItem[] = [];
  for (const { bucket, issues } of groups) {
    if (issues.length === 0) continue;
    const collapsed = collapsedBucketIds.has(bucket.id);
    items.push({
      kind: "header",
      key: `${bucket.id}:header`,
      bucket,
      count: issues.length,
      collapsed,
    });
    if (collapsed) continue;
    for (const issue of issues) {
      const occurrenceKey = `${bucket.id}:${issue.id}`;
      items.push({
        kind: "issue",
        key: occurrenceKey,
        occurrenceKey,
        bucket,
        issue,
      });
    }
  }
  return items;
}
