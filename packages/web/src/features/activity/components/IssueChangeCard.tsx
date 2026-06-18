"use client";

import { StatusBadge } from "@/components/ui/status-icon";
import type { RecentActivityEvent } from "@reef/core";
import type { ReactNode } from "react";
import type { ActivityFeedItem } from "../types";
import { ActivityCardHeader } from "./ActivityCardHeader";

/**
 * Short, kind-specific badge label for a recorded change. The Activity log
 * widened beyond status to assignee/priority/planning/delivery-ref events
 * (REEF-126); the feed surfaces every kind (REEF-077 AC1).
 */
function changeBadge(event: RecentActivityEvent): string {
  switch (event.event_type) {
    case "status_change":
      return "Status change";
    case "assignee_change":
      return "Assignee";
    case "priority_change":
      return "Priority";
    case "planning_link":
      return "Planning";
    case "impl_ref_linked":
      return "Delivery ref";
  }
}

const FromTo = ({ from, to }: { from: ReactNode; to: ReactNode }) => (
  <span className="text-sm text-foreground">
    {from}{" "}
    <span aria-hidden className="text-muted-foreground">
      →
    </span>{" "}
    {to}
  </span>
);

/** Compact one-line description of what the change did. */
function changeDetail(event: RecentActivityEvent): ReactNode {
  switch (event.event_type) {
    case "status_change":
      return (
        <span className="flex items-center gap-2 text-sm">
          <StatusBadge status={event.payload.from} size={14} />
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
          <StatusBadge status={event.payload.to} size={14} />
        </span>
      );
    case "assignee_change":
      return (
        <FromTo
          from={event.payload.from ?? "Unassigned"}
          to={event.payload.to ?? "Unassigned"}
        />
      );
    case "priority_change":
      return (
        <FromTo
          from={event.payload.from ?? "None"}
          to={event.payload.to ?? "None"}
        />
      );
    case "planning_link": {
      const { field, from, to } = event.payload;
      const label = field.charAt(0).toUpperCase() + field.slice(1);
      const verb =
        to === null ? "unlinked" : from === null ? "linked" : "changed";
      return (
        <span className="text-sm text-foreground">
          {label} {verb}
        </span>
      );
    }
    case "impl_ref_linked":
      return (
        <span className="text-sm text-foreground">
          Linked {event.payload.ref_type.replace("_", " ")} {event.payload.ref}
        </span>
      );
  }
}

/**
 * Informational card for a recorded issue change (REEF-063 / REEF-126
 * `reef_activity` event) surfaced in the Activity feed (REEF-077). Unlike the AI
 * proposal cards, it carries NO Approve/Edit/Dismiss actions and uses the neutral
 * (non-AI) tone — it states what already happened, it is not awaiting review.
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
        badge={changeBadge(event)}
        timestamp={item.timestamp}
        issueId={item.issueId}
        issueTitle={item.issueTitle}
      >
        <div className="mt-1" data-testid="issue-change-detail">
          {changeDetail(event)}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">by {event.actor}</p>
      </ActivityCardHeader>
    </div>
  );
}
