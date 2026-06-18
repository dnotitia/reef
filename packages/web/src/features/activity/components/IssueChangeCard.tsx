"use client";

import { StatusBadge } from "@/components/ui/status-icon";
import type { ActivityFeedItem } from "../types";
import { ActivityCardHeader } from "./ActivityCardHeader";

/**
 * Informational card for a recorded issue change (REEF-063 `reef_activity`
 * event) surfaced in the Activity feed (REEF-077). Unlike the AI proposal cards,
 * it carries NO Approve/Edit/Dismiss actions and uses the neutral (non-AI) tone
 * — it states what already happened, it is not awaiting review.
 */
export function IssueChangeCard({
  item,
}: {
  item: Extract<ActivityFeedItem, { type: "issue_change" }>;
}) {
  const { event } = item;
  return (
    <div
      data-testid="activity-item-issue_change"
      className="rounded-md border border-border bg-card px-4 py-3"
    >
      <ActivityCardHeader
        tone="neutral"
        badge="Status change"
        timestamp={item.timestamp}
        issueId={item.issueId}
        issueTitle={item.issueTitle}
      >
        <div
          className="mt-1 flex items-center gap-2 text-sm"
          data-testid="issue-change-transition"
        >
          <StatusBadge status={event.payload.from} size={14} />
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
          <StatusBadge status={event.payload.to} size={14} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">by {event.actor}</p>
      </ActivityCardHeader>
    </div>
  );
}
