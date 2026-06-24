"use client";

import { useStatusLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
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
export function CollapsedEventsRow({
  events,
  vault,
}: {
  events: SystemEntry[];
  vault: string;
}) {
  const statusLabels = useStatusLabels();
  const t = useTranslations("issues.activity");
  const [expanded, setExpanded] = useState(false);
  const from = fromStatus(events[0]);
  const to = toStatus(events[events.length - 1]);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="group/collapse flex w-full items-center gap-3 text-left focus-visible:outline-none"
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
          <ChevronRight
            className={cn(
              "size-3.5 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-[var(--ease-signature)]",
              expanded && "rotate-90",
            )}
            aria-hidden
          />
        </span>
        {/* Focus ring rides on the visible pill (driven by the button's
            focus-visible state) so keyboard focus is shown without a full-width
            ring — canonical ring-brand/40, matching the other buttons. */}
        <span className="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-xs text-muted-foreground transition-colors group-hover/collapse:bg-surface-hover group-focus-visible/collapse:ring-2 group-focus-visible/collapse:ring-brand/40">
          {t("statusChanges", { count: events.length })}
          {!expanded && from && to ? (
            <span className="text-muted-foreground">
              {" "}
              · {statusLabels[from]} → {statusLabels[to]}
            </span>
          ) : null}
        </span>
      </button>

      {expanded
        ? events.map((entry) => (
            <ActivityEventRow
              key={entry.event.id}
              event={entry.event}
              vault={vault}
            />
          ))
        : null}
    </div>
  );
}
