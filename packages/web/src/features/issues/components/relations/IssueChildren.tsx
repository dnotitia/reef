"use client";

import { IssueOptionRow } from "@/components/fields/IssueOptionRow";
import { PersonChip } from "@/components/fields/PersonChip";
import { useIssueDrill } from "@/features/issues/hooks/view/useIssueDrill";
import {
  type IssueRelationLike,
  indexIssuesById,
  unresolvedBlockerCountIn,
} from "@/features/issues/lib/dependencyUtils";
import { cn } from "@/lib/utils";
import {
  type IssueListItem,
  type Status,
  type VaultMember,
  isResolvedStatus,
} from "@reef/core";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { type ReactNode, memo, useId, useMemo, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTextOverflow } from "@/components/ui/overflow-tooltip";
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

type IssueDrillProps = ReturnType<typeof useIssueDrill>;

function isAssigneeTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-issue-option-slot="assignee"]') !== null
  );
}

interface IssueChildRowProps {
  child: IssueListItem;
  blockerCount: number;
  getDrillProps: IssueDrillProps;
  membersByUsername: ReadonlyMap<string, VaultMember>;
  resolved: boolean;
}

function IssueChildRow({
  child,
  blockerCount,
  getDrillProps,
  membersByUsername,
  resolved,
}: IssueChildRowProps) {
  const t = useTranslations("issues.relations");
  const titleRef = useRef<HTMLSpanElement>(null);
  const isTitleOverflowing = useTextOverflow(titleRef, child.title);
  const titleDescriptionId = useId();
  const [activeTooltip, setActiveTooltip] = useState<
    "title" | "assignee" | null
  >(null);
  const assignedTo = child.assigned_to?.trim() || null;
  const member = assignedTo ? membersByUsername.get(assignedTo) : undefined;
  const assigneeName =
    member?.display_name?.trim() || assignedTo || t("unassigned");

  return (
    <div
      className={cn(
        // The row owns layout and hover state while its title link and
        // non-editable assignee button remain separate interactive elements.
        "flex min-w-0 flex-1 touch-manipulation items-center gap-3 rounded-md px-1.5 py-1 transition-colors duration-150 @max-[40rem]:flex-wrap",
        "hover:bg-surface-hover focus-within:outline-none focus-within:ring-2 focus-within:ring-brand-focus/40",
        resolved && "opacity-60 hover:opacity-100",
      )}
      onPointerMoveCapture={(event) => {
        // Pointer movement is the hover signal. A remounted row under a
        // stationary pointer emits no movement, so a drill-back leaves the
        // tooltip closed and avoids consuming the sheet's next Escape.
        if (
          !event.defaultPrevented &&
          !isAssigneeTarget(event.target) &&
          isTitleOverflowing
        ) {
          setActiveTooltip("title");
        }
      }}
      onPointerLeave={() => setActiveTooltip(null)}
    >
      <Link
        {...getDrillProps(child.id)}
        data-issue-id={child.id}
        aria-label={
          isTitleOverflowing ? `${child.id} ${child.title}` : undefined
        }
        aria-describedby={isTitleOverflowing ? titleDescriptionId : undefined}
        onFocus={() => {
          setActiveTooltip(isTitleOverflowing ? "title" : null);
        }}
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setActiveTooltip(null);
          }
        }}
        className="flex min-w-0 flex-1 touch-manipulation items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-150 @max-[40rem]:basis-full @max-[40rem]:flex-wrap focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
      >
        <Tooltip
          open={isTitleOverflowing && activeTooltip === "title"}
          onOpenChange={(open) => {
            setActiveTooltip((current) => {
              if (open) return "title";
              return current === "title" ? null : current;
            });
          }}
        >
          {/* The row owns hover state so Radix keeps this title trigger closed
            for a stationary pointer during an assignee → title focus move. */}
          <TooltipTrigger asChild>
            <span
              className="flex min-w-0 flex-1 @max-[40rem]:basis-full"
              onPointerMove={(event) => event.preventDefault()}
            >
              <IssueOptionRow
                issue={child}
                blockerCount={blockerCount}
                titleRef={titleRef}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>{child.title}</TooltipContent>
        </Tooltip>
        <span id={titleDescriptionId} className="sr-only">
          {isTitleOverflowing ? child.title : null}
        </span>
      </Link>
      <Tooltip
        open={activeTooltip === "assignee"}
        onOpenChange={(open) => {
          setActiveTooltip((current) => {
            if (open) return "assignee";
            return current === "assignee" ? null : current;
          });
        }}
      >
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid={`issue-child-assignee-${child.id}`}
            data-issue-option-slot="assignee"
            aria-label={t("assigneeLabel", { name: assigneeName })}
            title={assigneeName}
            onPointerEnter={() => setActiveTooltip("assignee")}
            onFocus={() => setActiveTooltip("assignee")}
            className="flex w-32 shrink-0 items-center justify-start rounded-md border-0 bg-transparent p-0 text-sm @max-[40rem]:ml-auto focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
          >
            <PersonChip
              identityKey={assignedTo}
              name={member?.display_name ?? null}
              fallbackLabel={t("unassigned")}
              size="sm"
              wrapperClassName="w-full min-w-0"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>{assigneeName}</TooltipContent>
      </Tooltip>
    </div>
  );
}

interface IssueChildrenProps {
  /** The parent issue whose children we list. */
  issueId: string;
  /** Whole-vault list already loaded by the detail panel. */
  allIssues: readonly IssueListItem[];
  /** Current vault roster already loaded by the detail panel. */
  members?: readonly VaultMember[];
  /**
   * Whole-vault relation graph for accurate blocker badges. Defaults to
   * `allIssues`; callers should pass the relations projection so a dependency on
   * an archived done/closed issue — absent from the displayed list — isn't
   * miscounted as a blocker.
   */
  relationGraph?: readonly IssueRelationLike[];
  /** Optional entry point for creating a child of the current issue. */
  action?: ReactNode;
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
 * scanning an epic sees what is left first. The section still renders when the
 * issue has no children so the child-list empty state and "add sub-issue" entry
 * point stay together in the main canvas.
 *
 * Memoized: the detail panel re-renders on every title/body keystroke, but the
 * `allIssues` / `relationGraph` props are stable across those edits, so the
 * O(n) derive + sort runs when the vault list actually changes.
 */
export const IssueChildren = memo(function IssueChildren({
  issueId,
  allIssues,
  members = [],
  relationGraph,
  action,
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

  // Build the roster index once so every child resolves its display name in
  // O(1), while the detail panel's existing roster query remains the
  // network source for member data.
  const membersByUsername = useMemo(
    () => new Map(members.map((member) => [member.username, member])),
    [members],
  );

  // Built once over the whole-vault relation graph so each row resolves its
  // blocker count in O(1) instead of rebuilding the dependency map per row.
  const blockedIndex = useMemo(
    () => indexIssuesById(relationGraph ?? allIssues),
    [relationGraph, allIssues],
  );

  // Opening a sub-issue is an in-sheet drill (REEF-270): it swaps the panel to
  // the child and records the hop so Back returns to this parent.
  const getDrillProps = useIssueDrill(issueId);

  const total = children.length;
  const doneCount = children.filter((child) =>
    isResolvedStatus(child.status),
  ).length;

  return (
    <IssueFormSection title={t("subIssues")} action={action}>
      <div className="flex min-w-0 flex-col gap-2" data-testid="issue-children">
        {total === 0 ? (
          <p
            data-testid="issue-children-empty"
            className="w-fit max-w-full px-1.5 py-1 text-xs text-muted-foreground/80"
          >
            {t("noSubIssues")}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              {/* Animate transform (not width) so the bar fill stays off the layout
                  path; transform-origin left grows it from the start. */}
              <div
                className="h-1 flex-1 overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-valuenow={doneCount}
                aria-valuemin={0}
                aria-valuemax={total}
                aria-label={t("progressLabel", { done: doneCount, total })}
              >
                <div
                  className="h-full origin-left rounded-full bg-brand-fill transition-transform duration-300 motion-reduce:transition-none"
                  style={{ transform: `scaleX(${doneCount / total})` }}
                />
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {t("progressCount", { done: doneCount, total })}
              </span>
            </div>

            <TooltipProvider>
              <ul
                aria-label={t("subIssues")}
                // Keep the link's 2px teal focus ring inside the detail main's
                // horizontal clipping boundary without changing the row grid.
                className="flex flex-col gap-0.5 px-1"
              >
                {children.map((child) => (
                  <li key={child.id} className="@container">
                    <IssueChildRow
                      child={child}
                      blockerCount={unresolvedBlockerCountIn(
                        child,
                        blockedIndex,
                      )}
                      getDrillProps={getDrillProps}
                      membersByUsername={membersByUsername}
                      resolved={isResolvedStatus(child.status)}
                    />
                  </li>
                ))}
              </ul>
            </TooltipProvider>
          </>
        )}
      </div>
    </IssueFormSection>
  );
});
