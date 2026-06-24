"use client";

import { StatusIcon } from "@/components/ui/status-icon";
import { useStatusLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";
import type { CalendarDay, TimelineItem } from "../lib/timelineLayout";
import { TimelineBar } from "./TimelineBar";

interface TimelineRowProps {
  item: TimelineItem;
  days: CalendarDay[];
  gridStyle: CSSProperties;
  onIssueClick: (id: string) => void;
}

function isWeekend(day: CalendarDay): boolean {
  const weekDay = new Date(
    Date.UTC(day.year, day.month - 1, day.day),
  ).getUTCDay();
  return weekDay === 0 || weekDay === 6;
}

export function TimelineRow({
  item,
  days,
  gridStyle,
  onIssueClick,
}: TimelineRowProps) {
  const statusLabels = useStatusLabels();
  return (
    <div
      data-testid="timeline-row"
      className="grid min-h-9 border-b border-border-subtle"
      style={gridStyle}
    >
      <button
        type="button"
        onClick={() => onIssueClick(item.issue.id)}
        className={cn(
          "sticky left-0 z-20 flex min-w-0 items-center gap-2 border-r border-border-subtle bg-background px-3 text-left",
          "transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        )}
        style={{ gridColumn: 1, gridRow: 1 }}
      >
        <StatusIcon status={item.issue.status} size={12} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {item.issue.id}
          </span>
          <span className="block truncate text-[12px] font-medium text-foreground">
            {item.issue.title}
          </span>
        </span>
        {item.issue.assigned_to && (
          <span
            className="hidden max-w-20 truncate text-[11px] text-muted-foreground lg:block"
            title={item.issue.assigned_to}
          >
            @{item.issue.assigned_to}
          </span>
        )}
        <span className="sr-only">{statusLabels[item.issue.status]}</span>
      </button>
      {days.map((day, index) => (
        <div
          key={day.key}
          aria-hidden="true"
          className={cn(
            "border-r border-border-subtle/70",
            isWeekend(day) && "bg-surface-subtle/70",
          )}
          style={{ gridColumn: index + 2, gridRow: 1 }}
        />
      ))}
      <TimelineBar item={item} onClick={onIssueClick} />
    </div>
  );
}
