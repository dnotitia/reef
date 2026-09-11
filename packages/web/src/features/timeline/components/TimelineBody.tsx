"use client";

import { Button } from "@/components/ui/button";
import { SearchProgressBar } from "@/components/ui/SearchProgressBar";
import { Skeleton } from "@/components/ui/skeleton";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import { useResolvedAutoHideWindows } from "@/features/issues/hooks/useResolvedAutoHideWindows";
import { useOpenIssue } from "@/features/issues/hooks/view/useOpenIssue";
import { useWorkflowStatusGuard } from "@/features/issues/hooks/view/useWorkflowStatusGuard";
import { buildIssueQuery } from "@/features/issues/lib/buildIssueQuery";
import { applyDependencyFilter } from "@/features/issues/lib/dependencyUtils";
import {
  filterIssues,
  searchIssues,
} from "@/features/issues/lib/issueListUtils";
import {
  filterForIssueScope,
  hasScopeFilters,
} from "@/features/issues/lib/scopeFilter";
import type { IssueScope } from "@/features/issues/lib/viewMode";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import type { IssueListItem } from "@reef/core";
import { WORKFLOW_STATUS_OPTIONS } from "@reef/core/fields";
import { useTranslations } from "next-intl";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  calendarDayFromDate,
  getPlanningOverlay,
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
  scope?: IssueScope;
}

/**
 * Gantt-style timeline view body for the issues workspace. Self-contained:
 * owns its own data fetch, quarter range state, filter projection, and
 * loading/error/empty states. The surrounding chrome (PageHeader,
 * ViewSwitcher, IssueFilterToolbar, vault-empty state) is owned by
 * IssuesWorkspace; the quarter navigation controls live in this body's own
 * sub-toolbar since they are timeline-specific.
 */
export function TimelineBody({ vault, scope = "active" }: TimelineBodyProps) {
  const t = useTranslations("timeline");
  const c = useTranslations("common");
  // The timeline groups by workflow status just; keep a stray backlog status
  // filter from blanking it (REEF-109).
  useWorkflowStatusGuard(scope === "active");
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchTransitionPending = deferredSearchQuery !== searchQuery;
  const settledSearchQueryRef = useRef(searchQuery);
  const scopedFilter = useMemo(
    () => filterForIssueScope(filter, scope),
    [filter, scope],
  );
  // Server-side narrows the transfer (facets + free-text search); the client
  // pipeline below still applies due/label/dependency residuals and the
  // quarter-window layout.
  const query = useMemo(
    () => buildIssueQuery(filter, searchQuery, scope),
    [filter, scope, searchQuery],
  );
  const {
    data: issues,
    isPending,
    isFetching,
    isError,
    isPlaceholderData,
    refetch,
  } = useIssueList(vault, query);
  // Placeholder data belongs to the previous query. Keep its filter and grid
  // visible until the replacement arrives, while the updating signal tells
  // the user that the latest intent is still converging.
  const displaySearchQuery =
    isPlaceholderData || searchTransitionPending
      ? settledSearchQueryRef.current
      : deferredSearchQuery;
  useEffect(() => {
    if (!isPending && !isFetching && !isPlaceholderData) {
      settledSearchQueryRef.current = searchQuery;
    }
  }, [isFetching, isPending, isPlaceholderData, searchQuery]);
  const planningQuery = usePlanningCatalog(vault);
  const staleWindowDays = useResolvedAutoHideWindows(vault);
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
    const filtered = filterIssues(allIssues, scopedFilter, {
      searchActive: displaySearchQuery.trim().length > 0,
      staleWindowDays,
    });
    const searched = searchIssues(filtered, displaySearchQuery);
    const depFiltered = applyDependencyFilter(
      searched,
      scopedFilter.dependencyFilter ?? null,
      graph,
    );
    // The timeline groups by workflow status just; drop backlog at the source so
    // the empty-state check and the rendered rows agree — a result set of just
    // backlog issues reads as an empty timeline, not a blank grid (REEF-109).
    return depFiltered.filter((issue) => WORKFLOW_STATUS_SET.has(issue.status));
  }, [allIssues, displaySearchQuery, graph, scopedFilter, staleWindowDays]);

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
  const activeFilters = hasScopeFilters(filter, searchQuery, scope);
  const resultsUpdating =
    searchTransitionPending || isPlaceholderData || (isFetching && !isPending);
  const planningOverlay = useMemo(
    () => getPlanningOverlay(planningQuery.data, range),
    [planningQuery.data, range],
  );
  const hasPlanningItems =
    planningOverlay.sprintBands.length > 0 ||
    planningOverlay.markerStacks.length > 0;
  const shouldRenderGrid =
    visibleIssues.length > 0 || hasPlanningItems || planningQuery.isError;

  function clearFilters() {
    useIssueStore.getState().clearFilter();
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Timeline-specific sub-toolbar: range label + quarter navigation. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-subtle px-6 py-2">
        <span className="type-caption min-w-0 truncate text-muted-foreground">
          {range.label}
        </span>
        <div className="shrink-0">
          <TimelineControls
            range={range}
            onPrevious={() =>
              setQuarterReference((prev) => shiftQuarter(prev, -1))
            }
            onNext={() => setQuarterReference((prev) => shiftQuarter(prev, 1))}
            onToday={handleToday}
          />
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="pointer-events-none sticky top-0 z-10 h-0 overflow-visible">
          <SearchProgressBar
            active={resultsUpdating}
            className="top-0 bottom-auto"
          />
        </div>
        {resultsUpdating && (
          <span role="status" aria-live="polite" className="sr-only">
            {c("updatingResults")}
          </span>
        )}
        {isPending ||
        (planningQuery.isPending && visibleIssues.length === 0) ? (
          <div role="status" aria-live="polite" className="h-full">
            <span className="sr-only">{t("loading")}</span>
            <TimelineSkeleton />
          </div>
        ) : (
          <>
            {isError && (
              <div
                className="mx-6 mt-4 rounded-md border border-destructive-focus/30 bg-destructive-fill/5 px-3 py-2 text-sm text-destructive-text"
                role="alert"
                aria-live="assertive"
              >
                {t("loadError")}{" "}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto px-0 text-destructive-text"
                  onClick={() => refetch()}
                >
                  {c("retry")}
                </Button>
              </div>
            )}
            {planningQuery.isError && (
              <div
                data-testid="timeline-planning-error"
                className="mx-6 mt-4 rounded-md border border-destructive-focus/30 bg-destructive-fill/5 px-3 py-2 text-sm text-destructive-text"
                role="alert"
                aria-live="assertive"
              >
                {t("planningLoadError")}{" "}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto px-0 text-destructive-text"
                  onClick={() => planningQuery.refetch()}
                >
                  {c("retry")}
                </Button>
              </div>
            )}
            {resultsUpdating && !shouldRenderGrid ? (
              <div
                className="flex h-full items-center justify-center px-6 py-12"
                role="status"
                aria-live="polite"
              >
                <span className="text-sm text-muted-foreground">
                  {c("updatingResults")}
                </span>
              </div>
            ) : !shouldRenderGrid ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12">
                <p className="text-sm text-muted-foreground">
                  {activeFilters ? t("noMatch") : t("empty")}
                </p>
                {activeFilters && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={clearFilters}
                  >
                    {c("clearFilters")}
                  </Button>
                )}
              </div>
            ) : (
              <TimelineGrid
                ref={gridRef}
                range={range}
                today={today}
                items={timelineItems}
                planningOverlay={planningOverlay}
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
