"use client";

import { STATUS_LABELS } from "@/components/fields/fieldKit";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { ActivityEventRow } from "./ActivityEventRow";
import type { SystemEntry } from "./timelineModel";

/** The to-status of a status-change entry, for the collapsed summary. */
function toStatus(entry: SystemEntry | undefined) {
  return entry?.event.kind === "status_change" ? entry.event.to : null;
}

/** The from-status (falling back to the to-status) for the collapsed summary. */
function fromStatus(entry: SystemEntry | undefined) {
  if (entry?.event.kind !== "status_change") return null;
  return entry.event.from ?? entry.event.to;
}

/**
 * A folded run of consecutive status changes (REEF-064 AC3). Collapsed by
 * default to a single line — "N status changes · from → to" — and expands inline
 * to the individual events. The toggle is one button (chevron node + label) so
 * the whole row is one accessible control with `aria-expanded`.
 */
export function CollapsedEventsRow({ events }: { events: SystemEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const from = fromStatus(events[0]);
  const to = toStatus(events[events.length - 1]);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="group/collapse flex w-full items-center gap-3 text-left"
      >
        <span className="relative z-[1] flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform duration-150 ease-[var(--ease-signature)]",
              expanded && "rotate-90",
            )}
            aria-hidden
          />
        </span>
        <span className="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-xs text-muted-foreground transition-colors group-hover/collapse:bg-surface-hover">
          {events.length} status changes
          {!expanded && from && to ? (
            <span className="text-muted-foreground">
              {" "}
              · {STATUS_LABELS[from]} → {STATUS_LABELS[to]}
            </span>
          ) : null}
        </span>
      </button>

      {expanded
        ? events.map((entry) => (
            <ActivityEventRow key={entry.event.id} event={entry.event} />
          ))
        : null}
    </div>
  );
}
