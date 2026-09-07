"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePlanningKindSingularLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import {
  type CalendarDay,
  type TimelinePlanningMarker,
  type TimelinePlanningMarkerStack,
  type TimelinePlanningOverlay,
  type TimelineSprintBand,
  formatCalendarDay,
} from "../lib/timelineLayout";

interface TimelinePlanningHeaderProps {
  days: CalendarDay[];
  gridStyle: CSSProperties;
  overlay: TimelinePlanningOverlay;
}

const MARKER_KIND_KEYS = {
  milestone: "milestones",
  release: "releases",
} as const;

function sprintBandClasses(status: TimelineSprintBand["status"]): string {
  return status === "active"
    ? "border-planning-active/50 bg-planning-active/15 text-planning-active"
    : "border-planning-closed/40 bg-planning-closed/10 text-planning-closed";
}

function markerClasses(kind: TimelinePlanningMarker["kind"]): string {
  return kind === "milestone"
    ? "border-planning-open bg-planning-open/15 text-planning-open"
    : "border-planning-released bg-planning-released/15 text-planning-released";
}

function markerLabel(
  marker: TimelinePlanningMarker,
  labels: ReturnType<typeof usePlanningKindSingularLabels>,
  t: ReturnType<typeof useTranslations<"timeline">>,
): string {
  return t("planningMarkerItem", {
    kind: labels[MARKER_KIND_KEYS[marker.kind]],
    name: marker.name,
    date: formatCalendarDay(marker.date),
  });
}

function markerStackDescription(
  stack: TimelinePlanningMarkerStack,
  labels: ReturnType<typeof usePlanningKindSingularLabels>,
  t: ReturnType<typeof useTranslations<"timeline">>,
): string {
  return [
    t("planningMarkerStack", {
      count: stack.markers.length,
      date: formatCalendarDay(stack.date),
    }),
    ...stack.markers.map((marker) => markerLabel(marker, labels, t)),
  ].join(" · ");
}

function SprintBand({
  band,
  t,
}: {
  band: TimelineSprintBand;
  t: ReturnType<typeof useTranslations<"timeline">>;
}) {
  const label = t("planningSprintBand", {
    name: band.name,
    start: formatCalendarDay(band.start),
    end: formatCalendarDay(band.end),
  });

  return (
    <div
      data-testid={`timeline-planning-sprint-${band.sprintId}`}
      aria-label={label}
      className={cn(
        "z-[1] mx-0.5 my-1 flex min-w-0 items-center overflow-hidden rounded-sm border px-1.5",
        "type-chart-label font-medium",
        sprintBandClasses(band.status),
      )}
      style={{
        gridColumn: `${band.startIndex + 2} / ${band.endIndex + 3}`,
        gridRow: 1,
      }}
      title={label}
    >
      <span className="truncate">{band.name}</span>
    </div>
  );
}

function MarkerStack({
  stack,
  labels,
  t,
}: {
  stack: TimelinePlanningMarkerStack;
  labels: ReturnType<typeof usePlanningKindSingularLabels>;
  t: ReturnType<typeof useTranslations<"timeline">>;
}) {
  const description = markerStackDescription(stack, labels, t);
  const firstMarker = stack.markers[0];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={`timeline-planning-marker-stack-${stack.date.key}`}
          aria-label={description}
          title={description}
          className="relative z-[2] flex h-7 min-w-0 cursor-default items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
          style={{
            gridColumn: stack.dateIndex + 2,
            gridRow: 2,
          }}
        >
          <span
            aria-hidden="true"
            data-kind={firstMarker?.kind}
            className={cn(
              "block h-3 w-3 rotate-45 rounded-[2px] border-2 bg-surface-elevated shadow-sm",
              firstMarker && markerClasses(firstMarker.kind),
            )}
          />
          {stack.markers.length > 1 && (
            <span
              aria-hidden="true"
              data-testid={`timeline-planning-marker-count-${stack.date.key}`}
              className="absolute right-0 top-0 min-w-4 rounded-full bg-surface-elevated px-1 text-center type-compact-mono font-semibold text-foreground shadow-sm ring-1 ring-border"
            >
              {stack.markers.length}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1">
          <p className="font-medium">
            {t("planningMarkerStack", {
              count: stack.markers.length,
              date: formatCalendarDay(stack.date),
            })}
          </p>
          <ul className="space-y-0.5 text-muted-foreground">
            {stack.markers.map((marker) => (
              <li key={`${marker.kind}-${marker.id}`}>
                {markerLabel(marker, labels, t)}
              </li>
            ))}
          </ul>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function TimelinePlanningHeader({
  days,
  gridStyle,
  overlay,
}: TimelinePlanningHeaderProps) {
  const t = useTranslations("timeline");
  const planningKindLabels = usePlanningKindSingularLabels();

  return (
    <TooltipProvider>
      <div
        data-testid="timeline-planning-header"
        className="grid min-h-16 grid-rows-[minmax(2.25rem,1fr)_1.75rem] border-b border-border-subtle bg-surface-subtle/60"
        style={{
          ...gridStyle,
          gridTemplateRows: "minmax(2.25rem,1fr) 1.75rem",
        }}
      >
        <div
          className="sticky left-0 z-40 row-span-2 flex items-center border-r border-border-subtle bg-surface-subtle px-3 type-chart-label font-medium text-muted-foreground"
          style={{ gridColumn: 1, gridRow: "1 / span 2" }}
        >
          {t("planning")}
        </div>
        {days.map((day, index) => (
          <div
            key={day.key}
            aria-hidden="true"
            className="row-span-2 border-r border-border-subtle/70"
            style={{ gridColumn: index + 2, gridRow: "1 / span 2" }}
          />
        ))}
        {overlay.sprintBands.map((band) => (
          <SprintBand key={band.sprintId} band={band} t={t} />
        ))}
        {overlay.markerStacks.map((stack) => (
          <MarkerStack
            key={stack.date.key}
            stack={stack}
            labels={planningKindLabels}
            t={t}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}
