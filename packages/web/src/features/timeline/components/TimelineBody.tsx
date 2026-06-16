"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WORKFLOW_STATUS_OPTIONS } from "@/components/ui/status-icon";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import { useOpenIssue } from "@/features/issues/hooks/view/useOpenIssue";
import { useWorkflowStatusGuard } from "@/features/issues/hooks/view/useWorkflowStatusGuard";
import { buildIssueQuery } from "@/features/issues/lib/buildIssueQuery";
import { applyDependencyFilter } from "@/features/issues/lib/dependencyUtils";
import {
  filterIssues,
  searchIssues,
} from "@/features/issues/lib/issueListUtils";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import type { IssueListItem } from "@reef/core";
import { useMemo, useRef, useState } from "react";
import {
  calendarDayFromDate,
  getQuarterRange,
  getTimelineItem,
  shiftQuarter,
} from "../lib/timelineLayout";
import { TimelineControls } from "./TimelineControls";
import { TimelineGrid, type TimelineGridHandle } from "./TimelineGrid";

const EMPTY_ISSUES: IssueListItem[] = [];
const WORKFLOW_STATUS_SET: ReadonlySet<string> = new Set(
  WORKFLOW_STATUS_OPTIONS,
);

function hasActiveFilters(
  filter: ReturnType<typeof useIssueStore.getState>["filter"],
  searchQuery: string,
): boolean {
  return !!(
    filter.status?.length ||
    filter.issueType?.length ||
    filter.priority?.length ||
    filter.assignee ||
    filter.requester ||
    filter.sprint_id ||
    filter.milestone_id ||
    filter.release_id ||
    filter.severity?.length ||
    filter.due?.length ||
    filter.label ||
    filter.dependencyFilter?.length ||
    searchQuery
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2 px-6 py-4">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-11/12" />
      <Skeleton className="h-9 w-10/12" />
    </div>
  );
}

interface TimelineBodyProps {
  vault: string;
}

/**
 * Gantt-style timeline view body for the issues workspace. Self-contained:
 * owns its own data fetch, quarter range state, filter projection, and
 * loading/error/empty states. The surrounding chrome (PageHeader,
 * ViewSwitcher, IssueFilterToolbar, vault-empty state) is owned by
 * IssuesWorkspace; the quarter navigation controls live in this body's own
 * sub-toolbar since they are timeline-specific.
 */
export function TimelineBody({ vault }: TimelineBodyProps) {
  // The timeline groups by workflow status just; keep a stray backlog status
  // filter from blanking it (REEF-109).
  useWorkflowStatusGuard();
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  // Server-side narrows the transfer (facets + free-text search); the client
  // pipeline below still applies due/label/dependency residuals and the
  // quarter-window layout.
  const query = useMemo(
    () => buildIssueQuery(filter, searchQuery),
    [filter, searchQuery],
  );
  const {
    data: issues,
    isPending,
    isError,
    refetch,
  } = useIssueList(vault, query);
  const openIssue = useOpenIssue();
  const [today, setToday] = useState(() => calendarDayFromDate(new Date()));
  const [quarterReference, setQuarterReference] = useState(() => new Date());

  const range = useMemo(
    () => getQuarterRange(quarterReference),
    [quarterReference],
  );

  const gridRef = useRef<TimelineGridHandle>(null);
  function handleToday() {
    // Recompute "now" on click so a tab left open across midnight or a quarter
    // boundary still resolves to the real today. If the shown quarter already is
    // the current one, re-center imperatively (the anchor effect won't fire);
    // otherwise jump quarters and let the grid's anchor effect place today.
    const now = new Date();
    setToday(calendarDayFromDate(now));
    if (
      getQuarterRange(quarterReference).start.key ===
      getQuarterRange(now).start.key
    ) {
      gridRef.current?.scrollToToday();
    } else {
      setQuarterReference(now);
    }
  }

  const { data: relations } = useIssueRelations(vault);
  const allIssues = issues ?? EMPTY_ISSUES;
  // Dependency graph: prefer the whole-vault relation projection so the
  // blocked/blocking filters stay correct even when the server query narrows
  // the displayed set (a blocker hidden by a facet/`q` should not read as
  // missing). Fall back to the displayed set until it loads (or in tests
  // without a relations mock). Mirrors KanbanBoard / IssueListTable.
  const graph = relations ?? allIssues;
  const visibleIssues = useMemo(() => {
    const filtered = filterIssues(allIssues, filter);
    const searched = searchIssues(filtered, searchQuery);
    const depFiltered = applyDependencyFilter(
      searched,
      filter.dependencyFilter ?? null,
      graph,
    );
    // The timeline groups by workflow status just; drop backlog at the source so
    // the empty-state check and the rendered rows agree — a result set of just
    // backlog issues reads as an empty timeline, not a blank grid (REEF-109).
    return depFiltered.filter((issue) => WORKFLOW_STATUS_SET.has(issue.status));
  }, [allIssues, filter, searchQuery, graph]);

  const timelineItems = useMemo(
    () =>
      visibleIssues.flatMap((issue) => {
        const item = getTimelineItem(issue, range, today);
        return item ? [item] : [];
      }),
    [range, today, visibleIssues],
  );
  const scheduledIds = useMemo(
    () => new Set(timelineItems.map((item) => item.issue.id)),
    [timelineItems],
  );
  const unscheduledIssues = useMemo(
    () => visibleIssues.filter((issue) => !scheduledIds.has(issue.id)),
    [scheduledIds, visibleIssues],
  );
  const activeFilters = hasActiveFilters(filter, searchQuery);

  function clearFilters() {
    useIssueStore.getState().clearFilter();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Timeline-specific sub-toolbar: range label + quarter navigation. */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-subtle px-6 py-2">
        <span className="text-[12px] text-muted-foreground">{range.label}</span>
        <TimelineControls
          range={range}
          onPrevious={() =>
            setQuarterReference((prev) => shiftQuarter(prev, -1))
          }
          onNext={() => setQuarterReference((prev) => shiftQuarter(prev, 1))}
          onToday={handleToday}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {isPending ? (
          <TimelineSkeleton />
        ) : (
          <>
            {isError && (
              <div className="mx-6 mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                Failed to load some issues. Displaying cached data if available.{" "}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto px-0 text-destructive"
                  onClick={() => refetch()}
                >
                  Retry
                </Button>
              </div>
            )}
            {visibleIssues.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12">
                <p className="text-sm text-muted-foreground">
                  {activeFilters
                    ? "No issues match your filters."
                    : "Your timeline is empty. Add start or due dates to begin planning."}
                </p>
                {activeFilters && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <TimelineGrid
                ref={gridRef}
                range={range}
                today={today}
                items={timelineItems}
                unscheduledIssues={unscheduledIssues}
                onIssueClick={openIssue}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
