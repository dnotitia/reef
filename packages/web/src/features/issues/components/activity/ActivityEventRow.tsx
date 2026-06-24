"use client";

import { DateDisplay } from "@/components/fields/DateDisplay";
import { PlanningKindIcon } from "@/components/fields/PlanningKindIcon";
import { StatusIcon } from "@/components/ui/status-icon";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import { findPlanningName } from "@/features/planning/lib/planningItems";
import {
  useClosedReasonLabels,
  usePlanningKindSingularLabels,
  usePriorityLabels,
  useStatusLabels,
} from "@/i18n/fieldLabels";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/relativeTime";
import type {
  ClosedReason,
  ImplementationRef,
  PlanningLinkField,
  Priority,
  RelationField,
  Status,
} from "@reef/core";
import type { PlanningKind } from "@reef/core/fields/planning";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  CircleDot,
  Flag,
  GaugeCircle,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Link2,
  Network,
  Tag,
  Type,
  UserRound,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, memo, useState } from "react";
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

/**
 * A `relation_change` dimension → its catalog key for the inline verb phrase
 * ("depends on" / "blocks" / "related to"). The localized word is threaded into
 * the full-sentence message as a placeholder so each locale owns word order
 * (REEF-298), rather than gluing a translated fragment into an English frame.
 */
const RELATION_WORD_KEY: Record<
  RelationField,
  "relation.depends_on" | "relation.blocks" | "relation.related_to"
> = {
  depends_on: "relation.depends_on",
  blocks: "relation.blocks",
  related_to: "relation.related_to",
};

/** Resolve a planning id to its human name; null when absent/unresolved. */
type PlanningNameResolver = (
  field: PlanningLinkField,
  id: string | null,
) => string | null;

/**
 * Active-locale label maps for the enum values an event line names (REEF-292).
 * `lineFor` is pure, so the component resolves these via the field-label hooks
 * and threads them in rather than reading module-level English maps.
 */
interface EventLabels {
  status: Record<Status, string>;
  priority: Record<Priority, string>;
  closedReason: Record<ClosedReason, string>;
  planningKindSingular: Record<PlanningKind, string>;
}

/** A short, human label for a delivery ref ("PR #25", "commit a1b2c3d"). */
function deliveryLabel(ref: ImplementationRef): string {
  if (ref.type === "pull_request") return `PR #${ref.ref.replace(/^#/, "")}`;
  if (ref.type === "commit") return `commit ${ref.ref.slice(0, 7)}`;
  return `branch ${ref.ref}`;
}

/**
 * The actor name as an emphasized inline token. An actor is a login/username —
 * a code identifier — so `translate="no"` keeps machine translation from
 * mangling it (REEF-279/282 convention).
 */
function Actor({ name }: { name: string }) {
  return (
    <span className="font-medium text-foreground" translate="no">
      {name}
    </span>
  );
}

/**
 * A login/username value (assignee) as a token. Like the actor, it is a code
 * identifier, so it is kept un-translated.
 */
function loginToken(text: string): ReactNode {
  return (
    <span className="font-medium text-foreground" translate="no">
      {text}
    </span>
  );
}

/**
 * A human-readable changed value (priority label, planning name) as a token.
 * Unlike a login, this is translatable prose — no `translate="no"`.
 */
function valueToken(text: string): ReactNode {
  return <span className="font-medium text-foreground">{text}</span>;
}

/**
 * A reef id (parent / relation target, e.g. `REEF-012`) as a token. Like a login
 * it is a code identifier, so it is kept un-translated. Unlike planning ids
 * (opaque UUIDs that need name resolution), a reef id is itself human-readable,
 * so it renders directly with no catalog lookup.
 */
function idToken(text: string): ReactNode {
  return (
    <span className="font-medium text-foreground" translate="no">
      {text}
    </span>
  );
}

/** Join a list of value tokens (labels) into a comma-separated inline run. */
function joinValueTokens(values: string[]): ReactNode {
  return values.map((value, index) => (
    <span key={value}>
      {index > 0 ? ", " : null}
      {valueToken(value)}
    </span>
  ));
}

/** Join a list of reef-id tokens (relation targets) into a comma-separated run. */
function joinIdTokens(ids: string[]): ReactNode {
  return ids.map((id, index) => (
    <span key={id}>
      {index > 0 ? ", " : null}
      {idToken(id)}
    </span>
  ));
}

/** A due-date value as a token — `YYYY-MM-DD` via the shared `DateDisplay`. */
function dateToken(iso: string): ReactNode {
  return (
    <span className="font-medium text-foreground">
      <DateDisplay date={iso} />
    </span>
  );
}

/**
 * The active-namespace translator (`issues.activity`). Each event line is a
 * complete interpolated sentence resolved through `t.rich` so every locale owns
 * word order (REEF-298): the actor, value labels, and id/login tokens are
 * threaded in as placeholders, and a `hasActor` select switches between the
 * actor-led form ("alice moved …") and the system form ("Status moved …").
 */
type ActivityTranslator = ReturnType<typeof useTranslations<"issues.activity">>;

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
    // REEF-277 parity set — all neutral, shape-coded glyphs; the changed value
    // is encoded once, in the line text.
    case "title_change":
      return <Type className="size-3.5 text-muted-foreground" aria-hidden />;
    case "labels_change":
      return <Tag className="size-3.5 text-muted-foreground" aria-hidden />;
    case "due_date_change":
      return (
        <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />
      );
    case "estimate_change":
      return (
        <GaugeCircle className="size-3.5 text-muted-foreground" aria-hidden />
      );
    case "parent_change":
      return <Network className="size-3.5 text-muted-foreground" aria-hidden />;
    case "relation_change":
      return <Link2 className="size-3.5 text-muted-foreground" aria-hidden />;
    case "archived_change": {
      // Distinct glyph per direction (archive vs restore), like delivery's
      // per-type icon — still neutral, not a status color.
      const Icon = event.to ? Archive : ArchiveRestore;
      return <Icon className="size-3.5 text-muted-foreground" aria-hidden />;
    }
  }
}

/** The one-line description, by event kind. */
function lineFor(
  event: TimelineSystemEvent,
  resolvePlanning: PlanningNameResolver,
  labels: EventLabels,
  t: ActivityTranslator,
): ReactNode {
  // The actor renders identically on every line — an emphasized, un-translated
  // login token. next-intl injects rich nodes through self-closing tag functions
  // (`<actor/>`), not plain values, so build it once as a tag. The `hasActor`
  // select drops the tag on the subject-led system phrasing (where it is never
  // invoked), so a null actor safely returns null.
  const anActor = event.actor;
  const hasActor = anActor ? "true" : "false";
  const actor = () => (anActor ? <Actor name={anActor} /> : null);

  switch (event.kind) {
    case "created":
      return t.rich("created", { hasActor, actor });
    case "status_change":
      // `from`/`to` are plain status-label strings here (bare text, no token
      // span), so they stay value placeholders rather than tags.
      return event.from
        ? t.rich("statusMoved", {
            hasActor,
            actor,
            from: labels.status[event.from],
            to: labels.status[event.to],
          })
        : t.rich("statusSet", {
            hasActor,
            actor,
            to: labels.status[event.to],
          });
    case "closed":
      return (
        <>
          {t.rich("closed", { hasActor, actor })}
          {event.reason ? (
            <span className="text-muted-foreground">
              {" "}
              · {labels.closedReason[event.reason]}
            </span>
          ) : null}
        </>
      );
    case "delivery": {
      const { ref } = event;
      const label = deliveryLabel(ref);
      // The label ("PR #25", "commit a1b2c3d", "branch …") is a code identifier
      // — translate="no" keeps it intact; the ref title stays translatable.
      const link = () =>
        ref.url ? (
          <a
            href={ref.url}
            target="_blank"
            rel="noopener noreferrer"
            translate="no"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {label}
          </a>
        ) : (
          <span className="font-medium text-foreground" translate="no">
            {label}
          </span>
        );
      const title = () => (ref.title ? <span> — {ref.title}</span> : null);
      // Lead with the actor when the ref carries provenance (activity-scan refs
      // record the PR/commit author), matching the other system rows (AC2). A
      // hand-recorded ref may have no actor — the system arm drops the lead.
      return t.rich("deliveryAdded", { hasActor, actor, link, title });
    }
    case "assignee_change": {
      const { from, to } = event;
      if (from && to)
        return t.rich("assigneeReassigned", {
          hasActor,
          actor,
          from: () => loginToken(from),
          to: () => loginToken(to),
        });
      if (to)
        return t.rich("assigneeAssigned", {
          hasActor,
          actor,
          to: () => loginToken(to),
        });
      if (from)
        return t.rich("assigneeUnassigned", {
          hasActor,
          actor,
          from: () => loginToken(from),
        });
      return t.rich("assigneeChanged", { hasActor, actor });
    }
    case "priority_change": {
      const { from, to } = event;
      // `from`/`to` are bare priority-label strings (value placeholders); the
      // single "set" target keeps its emphasis token, so it is a tag.
      if (from && to)
        return t.rich("priorityChanged", {
          hasActor,
          actor,
          from: labels.priority[from],
          to: labels.priority[to],
        });
      if (to)
        return t.rich("prioritySet", {
          hasActor,
          actor,
          to: () => valueToken(labels.priority[to]),
        });
      if (from) return t.rich("priorityCleared", { hasActor, actor });
      return t.rich("priorityChangedNoValue", { hasActor, actor });
    }
    case "planning_link": {
      const kind = PLANNING_FIELD_KIND[event.field];
      // Lowercase kind word ("sprint"/"milestone"/"release") names the dimension
      // in text (a11y), reinforced by the shape glyph — a plain string value. A
      // raw id is not shown; an unresolved name simply drops the token (AC3).
      const word = labels.planningKindSingular[kind].toLowerCase();
      const fromName = resolvePlanning(event.field, event.from);
      const toName = resolvePlanning(event.field, event.to);
      if (event.from == null && event.to != null)
        return toName
          ? t.rich("planningAddedNamed", {
              hasActor,
              actor,
              word,
              name: () => valueToken(toName),
            })
          : t.rich("planningAdded", { hasActor, actor, word });
      if (event.from != null && event.to == null)
        return fromName
          ? t.rich("planningRemovedNamed", {
              hasActor,
              actor,
              word,
              name: () => valueToken(fromName),
            })
          : t.rich("planningRemoved", { hasActor, actor, word });
      return t.rich("planningMoved", {
        hasActor,
        actor,
        word,
        value: () => (
          <>
            {fromName ? valueToken(fromName) : null}
            {fromName && toName ? " → " : null}
            {toName ? valueToken(toName) : null}
          </>
        ),
      });
    }
    case "title_change":
      return t.rich("titleChanged", {
        hasActor,
        actor,
        from: () => valueToken(event.from),
        to: () => valueToken(event.to),
      });
    case "labels_change": {
      const { added, removed } = event;
      if (added.length && removed.length)
        return t.rich("labelsUpdated", {
          hasActor,
          actor,
          added: () => joinValueTokens(added),
          removed: () => joinValueTokens(removed),
        });
      // Singular vs plural ("added label" / "added labels") is chosen here so
      // each message stays a single-level select, matching how the row already
      // branched on count before localization (REEF-298).
      if (added.length)
        return added.length > 1
          ? t.rich("labelsAddedMany", {
              hasActor,
              actor,
              value: () => joinValueTokens(added),
            })
          : t.rich("labelsAddedOne", {
              hasActor,
              actor,
              value: () => joinValueTokens(added),
            });
      return removed.length > 1
        ? t.rich("labelsRemovedMany", {
            hasActor,
            actor,
            value: () => joinValueTokens(removed),
          })
        : t.rich("labelsRemovedOne", {
            hasActor,
            actor,
            value: () => joinValueTokens(removed),
          });
    }
    case "due_date_change": {
      const { from, to } = event;
      if (from && to)
        return t.rich("dueChanged", {
          hasActor,
          actor,
          from: () => dateToken(from),
          to: () => dateToken(to),
        });
      if (to)
        return t.rich("dueSet", { hasActor, actor, to: () => dateToken(to) });
      if (from) return t.rich("dueCleared", { hasActor, actor });
      return t.rich("dueChangedNoValue", { hasActor, actor });
    }
    case "estimate_change": {
      const { from, to } = event;
      if (from != null && to != null)
        return t.rich("estimateChanged", {
          hasActor,
          actor,
          from: () => valueToken(String(from)),
          to: () => valueToken(String(to)),
        });
      if (to != null)
        return t.rich("estimateSet", {
          hasActor,
          actor,
          to: () => valueToken(String(to)),
        });
      if (from != null) return t.rich("estimateCleared", { hasActor, actor });
      return t.rich("estimateChangedNoValue", { hasActor, actor });
    }
    case "parent_change": {
      const { from, to } = event;
      if (from && to)
        return t.rich("parentChanged", {
          hasActor,
          actor,
          from: () => idToken(from),
          to: () => idToken(to),
        });
      if (to)
        return t.rich("parentSet", { hasActor, actor, to: () => idToken(to) });
      if (from) return t.rich("parentRemoved", { hasActor, actor });
      return t.rich("parentChangedNoValue", { hasActor, actor });
    }
    case "relation_change": {
      const { relation, added, removed } = event;
      // `word` is the localized relation verb phrase — a plain string value.
      const word = t(RELATION_WORD_KEY[relation]);
      if (added.length && removed.length)
        return t.rich("relationUpdated", {
          hasActor,
          actor,
          word,
          added: () => joinIdTokens(added),
          removed: () => joinIdTokens(removed),
        });
      if (added.length)
        return t.rich("relationAdded", {
          hasActor,
          actor,
          word,
          ids: () => joinIdTokens(added),
        });
      return t.rich("relationRemoved", {
        hasActor,
        actor,
        word,
        ids: () => joinIdTokens(removed),
      });
    }
    case "archived_change":
      return event.to
        ? t.rich("archived", { hasActor, actor })
        : t.rich("restored", { hasActor, actor });
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
  const locale = useLocale();
  const t = useTranslations("issues.activity");
  // Resolve planning ids to names the same way board/list/draft surfaces do
  // (REEF-233). Cached per vault, so every row sharing the query pays once.
  const { data: planningCatalog } = usePlanningCatalog(vault);
  const resolvePlanning: PlanningNameResolver = (field, id) =>
    findPlanningName(planningCatalog, PLANNING_FIELD_KIND[field], id);

  // Active-locale labels for the enum values the line may name (REEF-292).
  const status = useStatusLabels();
  const priority = usePriorityLabels();
  const closedReason = useClosedReasonLabels();
  const planningKindSingular = usePlanningKindSingularLabels();
  const labels: EventLabels = {
    status,
    priority,
    closedReason,
    planningKindSingular,
  };

  return (
    <div className="flex items-center gap-3" data-testid="activity-event">
      {/* 20px node box matches the comment avatar's footprint, so the glyph
          aligns in the same left gutter as the comment avatars. */}
      <span className="flex size-5 shrink-0 items-center justify-center">
        {glyphFor(event)}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        <span className="min-w-0">
          {lineFor(event, resolvePlanning, labels, t)}
        </span>
        <time
          dateTime={event.at}
          title={formatAbsoluteTime(event.at, locale)}
          className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
        >
          {formatRelativeTime(event.at, nowMs, locale)}
        </time>
      </div>
    </div>
  );
});
