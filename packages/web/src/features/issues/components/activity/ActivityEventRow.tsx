"use client";

import { STATUS_LABELS } from "@/components/fields/fieldKit";
import { StatusIcon } from "@/components/ui/status-icon";
import type { ImplementationRef } from "@reef/core";
import { CLOSED_REASON_LABELS } from "@reef/core/fields";
import { CircleDot, GitBranch, GitCommit, GitPullRequest } from "lucide-react";
import { type ReactNode, memo } from "react";
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from "../comments/commentTime";
import type { TimelineSystemEvent } from "./timelineModel";

const DELIVERY_ICON = {
  pull_request: GitPullRequest,
  commit: GitCommit,
  branch: GitBranch,
} as const;

/** A short, human label for a delivery ref ("PR #25", "commit a1b2c3d"). */
function deliveryLabel(ref: ImplementationRef): string {
  if (ref.type === "pull_request") return `PR #${ref.ref.replace(/^#/, "")}`;
  if (ref.type === "commit") return `commit ${ref.ref.slice(0, 7)}`;
  return `branch ${ref.ref}`;
}

/** The actor name as an emphasized inline token. */
function Actor({ name }: { name: string }) {
  return <span className="font-medium text-foreground">{name}</span>;
}

/** The glyph that sits on the spine, by event kind. */
function glyphFor(event: TimelineSystemEvent): ReactNode {
  switch (event.kind) {
    case "created":
      // Origin of the thread — neutral, never a status color.
      return (
        <CircleDot className="size-3.5 text-muted-foreground" aria-hidden />
      );
    case "status_change":
      // never-fill status glyph in the to-status color (the single encoding of
      // the new state; the inline labels stay plain).
      return <StatusIcon status={event.to} size={14} decorative />;
    case "closed":
      return <StatusIcon status="closed" size={14} decorative />;
    case "delivery": {
      const Icon = DELIVERY_ICON[event.ref.type];
      // Delivery stays neutral — status color is reserved for status changes.
      return <Icon className="size-3.5 text-muted-foreground" aria-hidden />;
    }
  }
}

/** The one-line description, by event kind. */
function lineFor(event: TimelineSystemEvent): ReactNode {
  switch (event.kind) {
    case "created":
      return event.actor ? (
        <>
          <Actor name={event.actor} /> created this issue
        </>
      ) : (
        "Issue created"
      );
    case "status_change":
      return event.from ? (
        <>
          {event.actor ? <Actor name={event.actor} /> : "Status"} moved{" "}
          {STATUS_LABELS[event.from]} → {STATUS_LABELS[event.to]}
        </>
      ) : (
        <>
          {event.actor ? <Actor name={event.actor} /> : "Status"} set to{" "}
          {STATUS_LABELS[event.to]}
        </>
      );
    case "closed":
      return (
        <>
          {event.actor ? <Actor name={event.actor} /> : "Issue"} closed this
          issue
          {event.reason ? (
            <span className="text-muted-foreground">
              {" "}
              · {CLOSED_REASON_LABELS[event.reason]}
            </span>
          ) : null}
        </>
      );
    case "delivery": {
      const { ref } = event;
      const label = deliveryLabel(ref);
      return (
        <>
          {ref.url ? (
            <a
              href={ref.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              {label}
            </a>
          ) : (
            <span className="font-medium text-foreground">{label}</span>
          )}
          {ref.title ? <span> — {ref.title}</span> : null}
        </>
      );
    }
  }
}

/**
 * One system / reconstructed event in the unified timeline (REEF-064): a glyph
 * node on the spine and a single muted line (actor · change · time). Lighter
 * than a comment by design — the two visual weights are the whole point of the
 * merged feed. Never a chip or filled badge; the only color is the status glyph.
 */
export const ActivityEventRow = memo(function ActivityEventRow({
  event,
}: {
  event: TimelineSystemEvent;
}) {
  return (
    <div className="flex items-center gap-3" data-testid="activity-event">
      {/* 20px disc matches the comment avatar's footprint so every node sits
          centered on the same spine; bg-background breaks the line cleanly. */}
      <span className="relative z-[1] flex size-5 shrink-0 items-center justify-center rounded-full bg-background">
        {glyphFor(event)}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        <span className="min-w-0">{lineFor(event)}</span>
        <time
          dateTime={event.at}
          title={formatAbsoluteTime(event.at)}
          className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
        >
          {formatRelativeTime(event.at, Date.now())}
        </time>
      </div>
    </div>
  );
});
