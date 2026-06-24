"use client";

import { IssueOptionRow } from "@/components/fields/IssueOptionRow";
import { useIssueDrill } from "@/features/issues/hooks/view/useIssueDrill";
import {
  type IssueRelationLike,
  indexIssuesById,
  unresolvedBlockerCountIn,
} from "@/features/issues/lib/dependencyUtils";
import { cn } from "@/lib/utils";
import { type IssueListItem, type Status, isResolvedStatus } from "@reef/core";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { memo, useMemo } from "react";
import { IssueFormSection } from "../shared/IssueFormSection";

/** Lifecycle order for sorting remaining children
 *  (backlog → todo → in_progress → in_review). */
const STATUS_ORDER: Record<Status, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  in_review: 3,
  done: 4,
  closed: 5,
};

interface IssueChildrenProps {
  /** The parent issue whose children we list. */
  issueId: string;
  /** Whole-vault list already loaded by the detail panel. */
  allIssues: readonly IssueListItem[];
  /**
   * Whole-vault relation graph for accurate blocker badges. Defaults to
   * `allIssues`; callers should pass the relations projection so a dependency on
   * an archived done/closed issue — absent from the displayed list — isn't
   * miscounted as a blocker.
   */
  relationGraph?: readonly IssueRelationLike[];
}

/**
 * Read list of an issue's children — every issue whose `parent_id` is the
 * current issue (REEF-081). The inverse of the `Parent` relation input, which
 *  showed the upward edge.
 *
 * Derived entirely from the already-loaded `allIssues`, so it adds no network
 * request and refreshes for free whenever a child's parent changes: the update
 * mutation invalidates the `['issues','list',vault]` query, `allIssues`
 * refetches, and this list recomputes. `parent_id` stays the single source of
 * truth — no duplicate field, no server projection.
 *
 * Remaining work (open/in_progress/in_review) sorts to the top in lifecycle
 * order; resolved children (done/closed) sink to the bottom, dimmed, so a PM
 * scanning an epic sees what is left first. The whole section is hidden when the
 * issue has no children, so a leaf issue keeps its compact detail view.
 *
 * Memoized: the detail panel re-renders on every title/body keystroke, but the
 * `allIssues` / `relationGraph` props are stable across those edits, so the
 * O(n) derive + sort runs when the vault list actually changes.
 */
export const IssueChildren = memo(function IssueChildren({
  issueId,
  allIssues,
  relationGraph,
}: IssueChildrenProps) {
  const t = useTranslations("issues.relations");
  const children = useMemo(() => {
    const mine = allIssues.filter((issue) => issue.parent_id === issueId);
    // Remaining first (lifecycle order), resolved last; stable id tiebreaker.
    // `toSorted` keeps the react-query array immutable (in-place sort would
    // corrupt the cached list).
    return mine.toSorted((a, b) => {
      const ra = isResolvedStatus(a.status) ? 1 : 0;
      const rb = isResolvedStatus(b.status) ? 1 : 0;
      if (ra !== rb) return ra - rb;
      const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (byStatus !== 0) return byStatus;
      return a.id.localeCompare(b.id);
    });
  }, [allIssues, issueId]);

  // Built once over the whole-vault relation graph so each row resolves its
  // blocker count in O(1) instead of rebuilding the dependency map per row.
  const blockedIndex = useMemo(
    () => indexIssuesById(relationGraph ?? allIssues),
    [relationGraph, allIssues],
  );

  // Opening a sub-issue is an in-sheet drill (REEF-270): it swaps the panel to
  // the child and records the hop so Back returns to this parent.
  const getDrillProps = useIssueDrill(issueId);

  if (children.length === 0) return null;

  const total = children.length;
  const doneCount = children.filter((child) =>
    isResolvedStatus(child.status),
  ).length;

  return (
    <IssueFormSection title={t("subIssues")}>
      <div className="flex min-w-0 flex-col gap-2" data-testid="issue-children">
        <div className="flex items-center gap-3">
          {/* Animate transform (not width) so the bar fill stays off the layout
              path; transform-origin left grows it from the start. */}
          {/* biome-ignore lint/a11y/useFocusableInteractive: progressbar is a non-focusable ARIA range widget (a status indicator), not a keyboard tab stop. */}
          <div
            className="h-1 flex-1 overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label={t("progressLabel", { done: doneCount, total })}
          >
            <div
              className="h-full origin-left rounded-full bg-brand transition-transform duration-300 motion-reduce:transition-none"
              style={{ transform: `scaleX(${doneCount / total})` }}
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t("progressCount", { done: doneCount, total })}
          </span>
        </div>

        <ul aria-label={t("subIssues")} className="flex flex-col gap-0.5">
          {children.map((child) => {
            const resolved = isResolvedStatus(child.status);
            return (
              <li key={child.id}>
                <Link
                  {...getDrillProps(child.id)}
                  data-issue-id={child.id}
                  className={cn(
                    // `min-w-0 flex-1` lets the IssueOptionRow grid inside truncate
                    // instead of overflowing the column (REEF-285), matching the
                    // navigable relation chip's Link.
                    "flex min-w-0 flex-1 touch-manipulation items-center rounded-md px-1.5 py-1 transition-colors duration-150",
                    "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                    resolved && "opacity-60 hover:opacity-100",
                  )}
                >
                  <IssueOptionRow
                    issue={child}
                    blockerCount={unresolvedBlockerCountIn(child, blockedIndex)}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </IssueFormSection>
  );
});
