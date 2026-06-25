"use client";

import { cn } from "@/lib/utils";
import { isResolvedStatus } from "@reef/core";
import { useTranslations } from "next-intl";
import { type TimelineItem, formatCalendarDay } from "../lib/timelineLayout";

interface TimelineBarProps {
  item: TimelineItem;
  onClick: (id: string) => void;
}

function barTone(item: TimelineItem): string {
  if (item.kind === "invalid") {
    return "border-dashed border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive/15";
  }
  if (item.isOverdue) {
    return "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/15";
  }
  if (isResolvedStatus(item.issue.status)) {
    return "border-border bg-surface-subtle text-muted-foreground opacity-80 hover:bg-surface-hover";
  }
  if (item.kind === "deadline") {
    return "border-brand/60 bg-brand/15 text-foreground hover:bg-brand/20";
  }
  if (item.kind === "start") {
    return "border-border bg-elevated text-foreground hover:bg-surface-hover";
  }
  return "border-brand/35 bg-brand/10 text-foreground hover:bg-brand/15";
}

export function TimelineBar({ item, onClick }: TimelineBarProps) {
  const t = useTranslations("timeline");
  const isMarker = item.kind === "deadline" || item.kind === "start";
  // Localized bar label/tooltip (REEF-306). The date keys stay locale-neutral
  // (REEF-294 owns date display); the start/due words follow the locale.
  const label = t("scheduledItemTooltip", {
    id: item.issue.id,
    title: item.issue.title,
    start: formatCalendarDay(item.start),
    due: formatCalendarDay(item.due),
  });

  return (
    <button
      type="button"
      data-testid="timeline-bar"
      aria-label={label}
      title={label}
      onClick={() => onClick(item.issue.id)}
      className={cn(
        "relative z-10 my-1 h-7 min-w-0 overflow-hidden rounded-md border px-2 text-left",
        "text-[11px] font-medium leading-7 transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        barTone(item),
        isMarker && "px-0 text-center",
      )}
      style={{
        gridColumn: `${item.startIndex + 2} / ${item.endIndex + 3}`,
        gridRow: 1,
      }}
    >
      {item.startsBeforeRange && (
        <span
          aria-hidden="true"
          className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] opacity-70"
        >
          &lt;{/* i18n-exempt */}
        </span>
      )}
      {isMarker ? (
        <span
          aria-hidden="true"
          className={cn(
            "mx-auto block h-full w-1.5 rounded-full",
            item.kind === "deadline" ? "bg-current" : "bg-foreground/40",
          )}
        />
      ) : (
        <span className="block truncate px-1.5">
          {item.issue.id} · {item.issue.title}
        </span>
      )}
      {item.endsAfterRange && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] opacity-70"
        >
          &gt;{/* i18n-exempt */}
        </span>
      )}
    </button>
  );
}
