"use client";

import { PlanningKindIcon } from "@/components/fields/PlanningKindIcon";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/components/fields/fieldKit";
import { StatusIcon } from "@/components/ui/status-icon";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import { findPlanningName } from "@/features/planning/lib/planningItems";
import type { ImplementationRef, PlanningLinkField } from "@reef/core";
import { CLOSED_REASON_LABELS } from "@reef/core/fields";
import {
  PLANNING_KIND_SINGULAR,
  type PlanningKind,
} from "@reef/core/fields/planning";
import {
  CircleDot,
  Flag,
  GitBranch,
  GitCommit,
  GitPullRequest,
  UserRound,
} from "lucide-react";
import { type ReactNode, memo, useState } from "react";
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

/** A `planning_link` field (singular) → the planning catalog kind (plural). */
const PLANNING_FIELD_KIND: Record<PlanningLinkField, PlanningKind> = {
  milestone: "milestones",
  sprint: "sprints",
  release: "releases",
};

/** Resolve a planning id to its human name; null when absent/unresolved. */
type PlanningNameResolver = (
  field: PlanningLinkField,
  id: string | null,
) => string | null;

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

/** A changed value (assignee login, priority label, planning name) as a token. */
function valueToken(text: string): ReactNode {
  return <span className="font-medium text-foreground">{text}</span>;
}

/**
 * Compose a field-change line (REEF-276). With an actor it reads
 * "alice <lead> <rest>"; without one it leads with the capitalized verb phrase
 * ("<Lead> <rest>") — the same actor-optional shape the status/closed rows use.
 */
function sentence(
  actor: string | null,
  lead: string,
  rest?: ReactNode,
): ReactNode {
  const leadNode = actor ? (
    <>
      <Actor name={actor} /> {lead}
    </>
  ) : (
    `${lead.charAt(0).toUpperCase()}${lead.slice(1)}`
  );
  return rest != null ? (
    <>
      {leadNode} {rest}
    </>
  ) : (
    leadNode
  );
}

/** The gutter glyph node, by event kind. */
function glyphFor(event: TimelineSystemEvent): ReactNode {
  switch (event.kind) {
    case "created":
      // Origin of the thread — neutral, not a status color.
      return (
        <CircleDot className="size-3.5 text-muted-foreground" aria-hidden />
      );
    case "status_change":
      // unfilled status glyph in the to-status color (the single encoding of
      // the new state; the inline labels stay plain).
      return <StatusIcon status={event.to} size={14} decorative />;
    case "closed":
      return <StatusIcon status="closed" size={14} decorative />;
    case "delivery": {
      const Icon = DELIVERY_ICON[event.ref.type];
      // Delivery stays neutral — status color is reserved for status changes.
      return <Icon className="size-3.5 text-muted-foreground" aria-hidden />;
    }
    case "assignee_change":
      return (
        <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
      );
    case "priority_change":
      // Neutral glyph — the priority is encoded once, in the label text (AC6).
      return <Flag className="size-3.5 text-muted-foreground" aria-hidden />;
    case "planning_link":
      // Canonical planning-kind glyph (shape-coded, not colored); decorative,
      // with the kind also named in the line text for screen readers (AC3/AC6).
      return (
        <PlanningKindIcon
          kind={PLANNING_FIELD_KIND[event.field]}
          size={14}
          decorative
          className="text-muted-foreground"
        />
      );
  }
}

/** The one-line description, by event kind. */
function lineFor(
  event: TimelineSystemEvent,
  resolvePlanning: PlanningNameResolver,
): ReactNode {
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
          {event.actor ? (
            <>
              <Actor name={event.actor} /> closed this issue
            </>
          ) : (
            "Closed"
          )}
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
      const link = ref.url ? (
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
      );
      const title = ref.title ? <span> — {ref.title}</span> : null;
      // Lead with the actor when the ref carries provenance (activity-scan refs
      // record the PR/commit author), matching the other system rows (AC2). A
      // hand-recorded ref may have no actor — fall back to the bare link.
      return event.actor ? (
        <>
          <Actor name={event.actor} /> added {link}
          {title}
        </>
      ) : (
        <>
          {link}
          {title}
        </>
      );
    }
    case "assignee_change": {
      const { from, to } = event;
      if (from && to)
        return sentence(
          event.actor,
          "reassigned",
          <>
            {valueToken(from)} → {valueToken(to)}
          </>,
        );
      if (to) return sentence(event.actor, "assigned this to", valueToken(to));
      if (from) return sentence(event.actor, "unassigned", valueToken(from));
      return sentence(event.actor, "changed the assignee");
    }
    case "priority_change": {
      const { from, to } = event;
      if (from && to)
        return sentence(
          event.actor,
          "changed priority",
          <>
            {PRIORITY_LABELS[from]} → {PRIORITY_LABELS[to]}
          </>,
        );
      if (to)
        return sentence(
          event.actor,
          "set priority to",
          valueToken(PRIORITY_LABELS[to]),
        );
      if (from) return sentence(event.actor, "cleared priority");
      return sentence(event.actor, "changed priority");
    }
    case "planning_link": {
      const kind = PLANNING_FIELD_KIND[event.field];
      // Lowercase kind word ("sprint"/"milestone"/"release") names the dimension
      // in text (a11y), reinforced by the shape glyph. A raw id is not shown —
      // an unresolved name simply drops the token (AC3).
      const word = PLANNING_KIND_SINGULAR[kind].toLowerCase();
      const fromName = resolvePlanning(event.field, event.from);
      const toName = resolvePlanning(event.field, event.to);
      if (event.from == null && event.to != null)
        return sentence(
          event.actor,
          `added to ${word}`,
          toName ? valueToken(toName) : null,
        );
      if (event.from != null && event.to == null)
        return sentence(
          event.actor,
          `removed from ${word}`,
          fromName ? valueToken(fromName) : null,
        );
      return sentence(
        event.actor,
        `moved ${word}`,
        <>
          {fromName ? valueToken(fromName) : null}
          {fromName && toName ? " → " : null}
          {toName ? valueToken(toName) : null}
        </>,
      );
    }
  }
}

/**
 * One system / reconstructed event in the unified timeline (REEF-064): a gutter
 * glyph node and a single muted line (actor · change · time). Lighter than a
 * comment by design — the two visual weights are the whole point of the merged
 * feed. Not a chip or filled badge; the color is the status glyph.
 */
export const ActivityEventRow = memo(function ActivityEventRow({
  event,
  vault,
}: {
  event: TimelineSystemEvent;
  /** Active vault — resolves `planning_link` ids to names (REEF-276). */
  vault: string;
}) {
  const [nowMs] = useState(() => Date.now());
  // Resolve planning ids to names the same way board/list/draft surfaces do
  // (REEF-233). Cached per vault, so every row sharing the query pays once.
  const { data: planningCatalog } = usePlanningCatalog(vault);
  const resolvePlanning: PlanningNameResolver = (field, id) =>
    findPlanningName(planningCatalog, PLANNING_FIELD_KIND[field], id);

  return (
    <div className="flex items-center gap-3" data-testid="activity-event">
      {/* 20px node box matches the comment avatar's footprint, so the glyph
          aligns in the same left gutter as the comment avatars. */}
      <span className="flex size-5 shrink-0 items-center justify-center">
        {glyphFor(event)}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        <span className="min-w-0">{lineFor(event, resolvePlanning)}</span>
        <time
          dateTime={event.at}
          title={formatAbsoluteTime(event.at)}
          className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
        >
          {formatRelativeTime(event.at, nowMs)}
        </time>
      </div>
    </div>
  );
});
