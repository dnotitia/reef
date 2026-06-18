import type {
  ActivityEvent,
  ClosedReason,
  Comment,
  ImplementationRef,
  IssueMetadata,
  Status,
} from "@reef/core";

/**
 * Pure model for the unified activity timeline (REEF-064).
 *
 * The three sources — comments (`reef_comments`), activity events
 * (`reef_activity`), and *reconstructed* events synthesized from the issue's own
 * fields — are merged at read time into one chronological feed. No new storage
 * and no unified table (AC4): this module only reshapes data already loaded.
 *
 * Reconstructed events backfill issues that predate the activity log (AC5):
 * `created`, each `delivery` ref, and the issue's current status (a `closed`
 * event when closed, otherwise a `status_change` to the current status). The
 * status-derived reconstruction is a *fallback* — when `reef_activity` already
 * records the transition that set the current status, the logged event wins and
 * the reconstruction is dropped, so a single change never shows twice.
 */

/** A normalized system event — an activity row or a reconstructed event. */
export type TimelineSystemEvent =
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "created";
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "status_change";
      /** null for a reconstructed "current status" event (prior status unknown). */
      from: Status | null;
      to: Status;
      source: string | null;
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "delivery";
      ref: ImplementationRef;
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "closed";
      reason: ClosedReason | null;
    };

export interface CommentEntry {
  type: "comment";
  at: string;
  comment: Comment;
}

export interface SystemEntry {
  type: "system";
  at: string;
  event: TimelineSystemEvent;
}

/** A folded run of ≥ COLLAPSE_THRESHOLD consecutive status-change events. */
export interface CollapsedEntry {
  type: "collapsed";
  at: string;
  events: SystemEntry[];
}

export type TimelineEntry = CommentEntry | SystemEntry | CollapsedEntry;

/**
 * A run of this many consecutive `status_change` events between comments folds
 * into a single expandable row. MVP keeps the rule deliberately simple: only
 * same-kind status-change runs collapse (AC3); `created` / `delivery` / `closed`
 * each carry unique information and never fold.
 */
export const COLLAPSE_THRESHOLD = 3;

/** Map a `reef_activity` event to a normalized status-change system event. */
function fromActivityEvent(event: ActivityEvent): TimelineSystemEvent {
  return {
    id: event.id,
    at: event.at,
    actor: event.actor,
    kind: "status_change",
    from: event.payload.from,
    to: event.payload.to,
    source: event.source,
  };
}

/** Stable de-dupe key for a delivery ref (vault-skill `type:repo:ref`). */
function deliveryId(ref: ImplementationRef): string {
  return `delivery:${ref.type}:${ref.repo ?? ""}:${ref.ref}`;
}

/**
 * Synthesize events from the issue's own fields (AC5). `created` and each
 * `delivery` ref are always emitted — the activity-log MVP records neither, so
 * they never duplicate a logged event. The status-derived event (a `closed`
 * when the issue is closed, otherwise a `status_change` to the current status)
 * is the fallback: it is dropped when an activity event already shares its
 * timestamp (the transition is logged) or when it coincides with creation.
 */
export function reconstructEvents(
  issue: IssueMetadata,
  activity: readonly ActivityEvent[],
): TimelineSystemEvent[] {
  const events: TimelineSystemEvent[] = [];

  events.push({
    id: "created",
    at: issue.created_at,
    actor: issue.created_by || null,
    kind: "created",
  });

  for (const ref of issue.implementation_refs ?? []) {
    events.push({
      id: deliveryId(ref),
      at: ref.detected_at ?? issue.updated_at ?? issue.created_at,
      actor: ref.actor ?? null,
      kind: "delivery",
      ref,
    });
  }

  const statusAt =
    issue.status === "closed"
      ? (issue.closed_at ?? issue.last_status_change)
      : issue.last_status_change;
  // Drop the fallback when reef_activity already logged the transition that set
  // the current status (activity wins, AC5), or when it coincides with creation
  // (the `created` event already represents the initial status).
  const loggedAtStatusTime =
    statusAt != null && activity.some((event) => event.at === statusAt);
  if (statusAt != null && statusAt !== issue.created_at && !loggedAtStatusTime) {
    if (issue.status === "closed") {
      events.push({
        id: "current-status",
        at: statusAt,
        actor: issue.updated_by || null,
        kind: "closed",
        reason: issue.closed_reason ?? null,
      });
    } else {
      events.push({
        id: "current-status",
        at: statusAt,
        actor: issue.updated_by || null,
        kind: "status_change",
        from: null,
        to: issue.status,
        source: null,
      });
    }
  }

  return events;
}

/** Sort rank at an equal timestamp: creation first, comments last. */
function entryRank(entry: CommentEntry | SystemEntry): number {
  if (entry.type === "comment") return 2;
  return entry.event.kind === "created" ? 0 : 1;
}

function entryId(entry: CommentEntry | SystemEntry): string {
  return entry.type === "comment" ? entry.comment.id : entry.event.id;
}

/**
 * Merge comments + activity + reconstructed events into one ascending feed
 * (oldest first, AC1). Ties break by kind rank then id so the order is total
 * and deterministic under test.
 */
export function buildEntries(
  comments: readonly Comment[],
  activity: readonly ActivityEvent[],
  issue: IssueMetadata,
): Array<CommentEntry | SystemEntry> {
  const entries: Array<CommentEntry | SystemEntry> = [];

  for (const comment of comments) {
    entries.push({ type: "comment", at: comment.created_at, comment });
  }
  for (const event of activity) {
    entries.push({ type: "system", at: event.at, event: fromActivityEvent(event) });
  }
  for (const event of reconstructEvents(issue, activity)) {
    entries.push({ type: "system", at: event.at, event });
  }

  return entries.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    const rank = entryRank(a) - entryRank(b);
    if (rank !== 0) return rank;
    return entryId(a) < entryId(b) ? -1 : 1;
  });
}

/** True when this system entry is a foldable status-change event. */
function isStatusChange(entry: CommentEntry | SystemEntry): entry is SystemEntry {
  return entry.type === "system" && entry.event.kind === "status_change";
}

/**
 * Fold runs of ≥ COLLAPSE_THRESHOLD consecutive status-change entries into a
 * single CollapsedEntry (AC3). Everything else passes through unchanged.
 */
export function collapseRuns(
  entries: ReadonlyArray<CommentEntry | SystemEntry>,
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  let run: SystemEntry[] = [];

  const flush = () => {
    if (run.length >= COLLAPSE_THRESHOLD) {
      out.push({ type: "collapsed", at: run[0].at, events: run });
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const entry of entries) {
    if (isStatusChange(entry)) {
      run.push(entry);
      continue;
    }
    flush();
    out.push(entry);
  }
  flush();
  return out;
}

/**
 * The full read-time pipeline: merge then collapse. The single entry point the
 * timeline component renders from.
 */
export function buildTimeline(
  comments: readonly Comment[],
  activity: readonly ActivityEvent[],
  issue: IssueMetadata,
): TimelineEntry[] {
  return collapseRuns(buildEntries(comments, activity, issue));
}
