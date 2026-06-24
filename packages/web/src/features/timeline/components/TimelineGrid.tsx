"use client";

import {
  StatusIcon,
  WORKFLOW_STATUS_OPTIONS,
} from "@/components/ui/status-icon";
import { useStatusLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { IssueListItem } from "@reef/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type CSSProperties,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import {
  type CalendarDay,
  DAY_WIDTH,
  LABEL_WIDTH,
  type TimelineItem,
  type TimelineRange,
  compareCalendarDays,
  computeTargetScrollLeft,
  diffCalendarDays,
  formatCalendarDay,
  getDaysInRange,
  getMonthSpans,
  sortTimelineItems,
} from "../lib/timelineLayout";
import { TimelineRow } from "./TimelineRow";

type TimelineGridStyle = CSSProperties & {
  "--timeline-day-width": string;
};

export interface TimelineGridHandle {
  /** Smooth-scroll the grid so today sits at its anchor offset. */
  scrollToToday: () => void;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface TimelineGridProps {
  range: TimelineRange;
  today: CalendarDay;
  items: TimelineItem[];
  unscheduledIssues: IssueListItem[];
  onIssueClick: (id: string) => void;
}

function isTodayVisible(range: TimelineRange, today: CalendarDay): boolean {
  return (
    compareCalendarDays(today, range.start) >= 0 &&
    compareCalendarDays(today, range.end) <= 0
  );
}

function isWeekTick(day: CalendarDay): boolean {
  const weekDay = new Date(
    Date.UTC(day.year, day.month - 1, day.day),
  ).getUTCDay();
  return day.day === 1 || weekDay === 1;
}

// Timeline groups by active workflow status just; `backlog` is excluded so the
// timeline mirrors the board's active surface (REEF-109). Backlog issues are
// managed in the dedicated backlog view, not on the schedule.
function groupItemsByStatus(items: TimelineItem[]) {
  return WORKFLOW_STATUS_OPTIONS.map((status) => ({
    status,
    items: sortTimelineItems(
      items.filter((item) => item.issue.status === status),
    ),
  })).filter((group) => group.items.length > 0);
}

function groupIssuesByStatus(issues: IssueListItem[]) {
  return WORKFLOW_STATUS_OPTIONS.map((status) => ({
    status,
    issues: issues
      .filter((issue) => issue.status === status)
      .sort((a, b) => a.id.localeCompare(b.id)),
  })).filter((group) => group.issues.length > 0);
}

function buildIssueTitle(issue: IssueListItem): string {
  return `${issue.id} ${issue.title}`;
}

export const TimelineGrid = forwardRef<TimelineGridHandle, TimelineGridProps>(
  function TimelineGrid(
    { range, today, items, unscheduledIssues, onIssueClick },
    ref,
  ) {
    const statusLabels = useStatusLabels();
    const scrollRef = useRef<HTMLDivElement>(null);
    const leftShadowRef = useRef<HTMLDivElement>(null);
    const rightShadowRef = useRef<HTMLDivElement>(null);
    const chevronRef = useRef<HTMLButtonElement>(null);

    const days = getDaysInRange(range);
    const monthSpans = getMonthSpans(range);
    const groupedItems = groupItemsByStatus(items);
    const groupedUnscheduled = groupIssuesByStatus(unscheduledIssues);
    const gridStyle: TimelineGridStyle = {
      "--timeline-day-width": `${DAY_WIDTH}px`,
      gridTemplateColumns: `${LABEL_WIDTH}px repeat(${days.length}, var(--timeline-day-width))`,
    };
    const minWidth = LABEL_WIDTH + days.length * DAY_WIDTH;
    const todayIndex = isTodayVisible(range, today)
      ? diffCalendarDays(range.start, today)
      : null;

    // Toggle the edge fade shadows and the direction chevron purely through DOM
    // attributes so frequent scroll events does not trigger a React re-render.
    const syncAffordance = useCallback(
      (el: HTMLDivElement) => {
        const { scrollLeft, scrollWidth, clientWidth } = el;
        const maxScroll = scrollWidth - clientWidth;
        leftShadowRef.current?.toggleAttribute("data-visible", scrollLeft > 1);
        rightShadowRef.current?.toggleAttribute(
          "data-visible",
          scrollLeft < maxScroll - 1,
        );
        const chevron = chevronRef.current;
        if (!chevron) return;
        if (todayIndex == null) {
          chevron.dataset.off = "";
          return;
        }
        const todayX = LABEL_WIDTH + todayIndex * DAY_WIDTH;
        chevron.dataset.off =
          todayX < scrollLeft + LABEL_WIDTH
            ? "left"
            : todayX > scrollLeft + clientWidth
              ? "right"
              : "";
      },
      [todayIndex],
    );

    const scrollToToday = useCallback(() => {
      const el = scrollRef.current;
      if (!el || todayIndex == null) return;
      el.scrollTo({
        left: computeTargetScrollLeft(el.clientWidth, todayIndex),
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }, [todayIndex]);

    useImperativeHandle(ref, () => ({ scrollToToday }), [scrollToToday]);

    // Anchor on mount and on quarter change just. range.start.key is an explicit
    // trigger (not read in the body) so data/filter re-renders does not yank the
    // user's scroll position; useLayoutEffect runs before paint so today does not
    // flashes at the left edge. A quarter without today resets to the start.
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-anchor is keyed on the quarter, not on values read inside the effect
    useLayoutEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollLeft =
        todayIndex != null
          ? computeTargetScrollLeft(el.clientWidth, todayIndex)
          : 0;
      syncAffordance(el);
    }, [range.start.key, todayIndex, syncAffordance]);

    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      let raf = 0;
      const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          syncAffordance(el);
        });
      };
      el.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        el.removeEventListener("scroll", onScroll);
        if (raf) cancelAnimationFrame(raf);
      };
    }, [syncAffordance]);

    return (
      <div className="relative h-full overflow-x-clip">
        {/* `isolate` keeps the inner sticky header/bar/label z-indexes contained
            so the pinned overlays below (shadows, chevron) paint above the whole
            scroller rather than being buried under the sticky header. */}
        <div
          ref={scrollRef}
          className="isolate h-full overflow-auto overscroll-x-contain"
          data-testid="timeline-grid"
        >
          <div
            className="relative min-h-full bg-background"
            style={{ minWidth }}
          >
            {todayIndex != null && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-brand/70"
                style={{ left: LABEL_WIDTH + todayIndex * DAY_WIDTH }}
              />
            )}

            <div className="sticky top-0 z-30 border-b border-border-subtle bg-background/95 backdrop-blur">
              <div className="grid h-8" style={gridStyle}>
                <div
                  className="sticky left-0 z-40 flex items-center border-r border-border-subtle bg-background px-3 text-xs font-medium text-muted-foreground"
                  style={{ gridColumn: 1 }}
                >
                  {range.label}
                </div>
                {monthSpans.map((span) => (
                  <div
                    key={span.key}
                    className="flex items-center justify-center border-r border-border-subtle text-[11px] font-semibold text-foreground"
                    style={{
                      gridColumn: `${span.startIndex + 2} / ${span.endIndex + 3}`,
                    }}
                  >
                    {span.label}
                  </div>
                ))}
              </div>
              <div className="grid h-7" style={gridStyle}>
                <div
                  className="sticky left-0 z-40 flex items-center border-r border-border-subtle bg-background px-3 text-[11px] text-muted-foreground"
                  style={{ gridColumn: 1 }}
                >
                  Issue
                </div>
                {days.map((day, index) => (
                  <div
                    key={day.key}
                    className={cn(
                      "flex items-center justify-center border-r border-border-subtle/70 text-[10px] text-muted-foreground",
                      todayIndex === index && "font-semibold text-brand",
                    )}
                    style={{ gridColumn: index + 2 }}
                    title={day.key}
                  >
                    {isWeekTick(day) ? day.day : ""}
                  </div>
                ))}
              </div>
            </div>

            <div>
              {groupedItems.length === 0 ? (
                <div
                  className="grid h-16 border-b border-border-subtle"
                  style={gridStyle}
                >
                  <div
                    className="sticky left-0 z-20 flex items-center border-r border-border-subtle bg-background px-3 text-xs text-muted-foreground"
                    style={{ gridColumn: 1 }}
                  >
                    Scheduled
                  </div>
                  <div
                    className="flex items-center px-4 text-sm text-muted-foreground"
                    style={{ gridColumn: `2 / ${days.length + 2}` }}
                  >
                    No scheduled issues in this quarter.
                  </div>
                </div>
              ) : (
                groupedItems.map((group) => (
                  <section
                    key={group.status}
                    aria-label={statusLabels[group.status]}
                  >
                    <div
                      className="grid h-8 border-b border-border-subtle bg-surface-subtle"
                      style={gridStyle}
                    >
                      <div
                        className="sticky left-0 z-20 flex items-center gap-2 border-r border-border-subtle bg-surface-subtle px-3 text-xs font-semibold text-foreground"
                        style={{ gridColumn: 1 }}
                      >
                        <StatusIcon status={group.status} size={13} />
                        {statusLabels[group.status]}
                      </div>
                      <div
                        className="flex items-center px-3 text-[11px] text-muted-foreground"
                        style={{ gridColumn: `2 / ${days.length + 2}` }}
                      >
                        {group.items.length} scheduled
                      </div>
                    </div>
                    {group.items.map((item) => (
                      <TimelineRow
                        key={item.issue.id}
                        item={item}
                        days={days}
                        gridStyle={gridStyle}
                        onIssueClick={onIssueClick}
                      />
                    ))}
                  </section>
                ))
              )}
            </div>

            {groupedUnscheduled.length > 0 && (
              <section
                data-testid="timeline-unscheduled"
                className="border-t border-border bg-background px-3 py-4"
                aria-label="Unscheduled"
              >
                <div className="sticky left-3 z-20 mb-3 max-w-[760px]">
                  <h2 className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                    Unscheduled
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Issues without a start date or due date.
                  </p>
                </div>
                <div className="sticky left-3 z-20 flex max-w-[760px] flex-col gap-3">
                  {groupedUnscheduled.map((group) => (
                    <div key={group.status}>
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <StatusIcon status={group.status} size={12} />
                        {statusLabels[group.status]}
                        <span className="text-muted-foreground">
                          {group.issues.length}
                        </span>
                      </div>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {group.issues.map((issue) => (
                          <button
                            key={issue.id}
                            type="button"
                            onClick={() => onIssueClick(issue.id)}
                            title={`${buildIssueTitle(issue)} · start ${formatCalendarDay(null)} · due ${formatCalendarDay(null)}`}
                            className="min-w-0 rounded-md border border-border bg-elevated px-2.5 py-2 text-left transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                          >
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">
                              {issue.id}
                            </span>
                            <span className="block truncate text-[12px] font-medium text-foreground">
                              {issue.title}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        {/* Pinned scroll affordances, kept outside the scroller so they stay at
          the viewport edges. The left shadow starts at LABEL_WIDTH so it does not
          covers the sticky issue-label column. */}
        <div
          ref={leftShadowRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 z-[2] w-8 bg-gradient-to-r from-background to-transparent opacity-0 transition-opacity duration-150 data-[visible]:opacity-100"
          style={{ left: LABEL_WIDTH }}
        />
        <div
          ref={rightShadowRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-8 bg-gradient-to-l from-background to-transparent opacity-0 transition-opacity duration-150 data-[visible]:opacity-100"
        />
        <button
          ref={chevronRef}
          type="button"
          data-off=""
          onClick={scrollToToday}
          aria-label="Scroll to today"
          className="group absolute top-2 z-[3] hidden items-center gap-1 rounded-full border border-brand/40 bg-elevated px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 data-[off=left]:left-3 data-[off=left]:flex data-[off=right]:right-3 data-[off=right]:flex"
        >
          <ChevronLeft
            aria-hidden="true"
            className="hidden h-3 w-3 text-brand group-data-[off=left]:block"
          />
          Today
          <ChevronRight
            aria-hidden="true"
            className="hidden h-3 w-3 text-brand group-data-[off=right]:block"
          />
        </button>
      </div>
    );
  },
);
