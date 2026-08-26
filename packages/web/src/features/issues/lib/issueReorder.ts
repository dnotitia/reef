import type { IssueListItem, IssueReorderGroup } from "@reef/core";

export interface IssueReorderTarget {
  issueId: string;
  beforeId: string | null;
  afterId: string | null;
  expected: {
    issueRank: number | null;
    issueUpdatedAt: string;
    beforeRank: number | null;
    beforeUpdatedAt: string | null;
    afterRank: number | null;
    afterUpdatedAt: string | null;
  };
}

export type IssueReorderGroupInput = IssueReorderGroup;

function makeTarget(
  issue: IssueListItem,
  before: IssueListItem | null,
  after: IssueListItem | null,
): IssueReorderTarget {
  return {
    issueId: issue.id,
    beforeId: before?.id ?? null,
    afterId: after?.id ?? null,
    expected: {
      issueRank: issue.rank ?? null,
      issueUpdatedAt: issue.updated_at,
      beforeRank: before?.rank ?? null,
      beforeUpdatedAt: before?.updated_at ?? null,
      afterRank: after?.rank ?? null,
      afterUpdatedAt: after?.updated_at ?? null,
    },
  };
}

/**
 * Build the target slot created by dropping `issue` onto a rendered item. The
 * returned neighbours are snapshots, not a persisted client-side ordering;
 * the server resolves them against its canonical rank order.
 */
export function buildIssueReorderTargetForDrop(
  issue: IssueListItem,
  targetItems: readonly IssueListItem[],
  overId: string,
): IssueReorderTarget | null {
  const withoutMoved = targetItems.filter((item) => item.id !== issue.id);
  const overIndex = withoutMoved.findIndex((item) => item.id === overId);
  if (overIndex < 0) return null;

  const sourceIndex = targetItems.findIndex((item) => item.id === issue.id);
  const originalOverIndex = targetItems.findIndex((item) => item.id === overId);
  const insertAt =
    sourceIndex >= 0 && sourceIndex < originalOverIndex
      ? overIndex + 1
      : overIndex;
  return makeTarget(
    issue,
    withoutMoved[insertAt - 1] ?? null,
    withoutMoved[insertAt] ?? null,
  );
}

function nextCanonicalItem(
  canonicalItems: readonly IssueListItem[],
  anchorId: string,
  excludedId: string,
): IssueListItem | null {
  const anchorIndex = canonicalItems.findIndex((item) => item.id === anchorId);
  if (anchorIndex < 0) return null;
  return (
    canonicalItems
      .slice(anchorIndex + 1)
      .find((item) => item.id !== excludedId) ?? null
  );
}

function completeBoardEdgeTarget(
  issue: IssueListItem,
  target: IssueReorderTarget,
  canonicalItems: readonly IssueListItem[],
): IssueReorderTarget {
  if (target.afterId !== null || target.beforeId === null) return target;
  const before =
    canonicalItems.find((item) => item.id === target.beforeId) ?? null;
  const after = before
    ? nextCanonicalItem(canonicalItems, before.id, issue.id)
    : null;
  return after ? makeTarget(issue, before, after) : target;
}

function buildCurrentCanonicalSlot(
  issue: IssueListItem,
  canonicalItems: readonly IssueListItem[],
): IssueReorderTarget | null {
  const sourceIndex = canonicalItems.findIndex((item) => item.id === issue.id);
  if (sourceIndex < 0) return null;
  const withoutMoved = canonicalItems.filter((item) => item.id !== issue.id);
  return makeTarget(
    issue,
    withoutMoved[sourceIndex - 1] ?? null,
    withoutMoved[sourceIndex] ?? null,
  );
}

/**
 * Build a Board target from the canonical rank spine of the destination group.
 * Board buckets are not themselves rank-ordered, so adjacent UI buckets are
 * never used as a before/after pair. An empty destination keeps the moved issue
 * at its current canonical slot; a populated destination uses its canonical
 * edge and fills a missing after anchor from the global spine.
 */
export function buildIssueReorderTargetForBoardDrop(
  issue: IssueListItem,
  canonicalTargetItems: readonly IssueListItem[],
  canonicalItems: readonly IssueListItem[],
  overId?: string,
): IssueReorderTarget | null {
  if (overId) {
    const target = buildIssueReorderTargetForDrop(
      issue,
      canonicalTargetItems,
      overId,
    );
    return target
      ? completeBoardEdgeTarget(issue, target, canonicalItems)
      : null;
  }

  const withoutMovedTarget = canonicalTargetItems.filter(
    (item) => item.id !== issue.id,
  );
  if (withoutMovedTarget.length > 0) {
    if (canonicalTargetItems.at(-1)?.id === issue.id) {
      return buildCurrentCanonicalSlot(issue, canonicalItems);
    }
    const before = withoutMovedTarget.at(-1) ?? null;
    const after = before
      ? nextCanonicalItem(canonicalItems, before.id, issue.id)
      : null;
    return makeTarget(issue, before, after);
  }

  return buildCurrentCanonicalSlot(issue, canonicalItems);
}

/**
 * Compute the anchors for a drag over a rendered item in a flat collection.
 * This is a convenience for List and Backlog; grouped Board drops use the
 * target-group helper above so the moved issue may come from another bucket.
 */
export function buildIssueReorderTargetFromDrop(
  ordered: readonly IssueListItem[],
  activeId: string,
  overId: string,
): IssueReorderTarget | null {
  const issue = ordered.find((item) => item.id === activeId);
  if (!issue || activeId === overId) return null;
  return buildIssueReorderTargetForDrop(issue, ordered, overId);
}

/**
 * Complete a bottom-of-visible-list target with the next known canonical row.
 * When that row is not loaded yet, report `needsMoreCanonicalItems` so the
 * caller can fetch another page instead of sending `after_id: null` (which the
 * server correctly interprets as the true scope tail).
 */
export function resolveIssueReorderTargetForDrop(
  visibleItems: readonly IssueListItem[],
  canonicalItems: readonly IssueListItem[],
  activeId: string,
  overId: string,
  hasNextPage: boolean,
): {
  target: IssueReorderTarget | null;
  needsMoreCanonicalItems: boolean;
} {
  const target = buildIssueReorderTargetFromDrop(
    visibleItems,
    activeId,
    overId,
  );
  if (!target || target.afterId !== null) {
    return { target, needsMoreCanonicalItems: false };
  }

  if (!target.beforeId) {
    return {
      target: hasNextPage ? null : target,
      needsMoreCanonicalItems: hasNextPage,
    };
  }

  const beforeIndex = target.beforeId
    ? canonicalItems.findIndex((item) => item.id === target.beforeId)
    : -1;
  if (target.beforeId && beforeIndex < 0) {
    return {
      target: hasNextPage ? null : target,
      needsMoreCanonicalItems: hasNextPage,
    };
  }
  const nextCanonical = canonicalItems
    .slice(beforeIndex + 1)
    .find((item) => item.id !== activeId);
  if (nextCanonical) {
    const before = target.beforeId
      ? (visibleItems.find((item) => item.id === target.beforeId) ??
        canonicalItems.find((item) => item.id === target.beforeId) ??
        null)
      : null;
    const issue = visibleItems.find((item) => item.id === activeId);
    if (issue) {
      return {
        target: makeTarget(issue, before, nextCanonical),
        needsMoreCanonicalItems: false,
      };
    }
  }

  return {
    target: hasNextPage ? null : target,
    needsMoreCanonicalItems: hasNextPage,
  };
}
