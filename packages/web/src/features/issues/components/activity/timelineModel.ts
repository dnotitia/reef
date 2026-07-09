import {
  ACTIVITY_EVENT_ARCHIVED_CHANGE,
  ACTIVITY_EVENT_ASSIGNEE_CHANGE,
  ACTIVITY_EVENT_ATTACHMENT_ADDED,
  ACTIVITY_EVENT_ATTACHMENT_REMOVED,
  ACTIVITY_EVENT_DUE_DATE_CHANGE,
  ACTIVITY_EVENT_ESTIMATE_CHANGE,
  ACTIVITY_EVENT_IMPL_REF_LINKED,
  ACTIVITY_EVENT_LABELS_CHANGE,
  ACTIVITY_EVENT_PARENT_CHANGE,
  ACTIVITY_EVENT_PLANNING_LINK,
  ACTIVITY_EVENT_PRIORITY_CHANGE,
  ACTIVITY_EVENT_RELATION_CHANGE,
  ACTIVITY_EVENT_STATUS_CHANGE,
  ACTIVITY_EVENT_TITLE_CHANGE,
  type ActivityEvent,
  type ClosedReason,
  type Comment,
  type ImplementationRef,
  type IssueMetadata,
  type PlanningLinkField,
  type Priority,
  type RelationField,
  type Status,
} from "@reef/core";

/**
 * The status-change variant of the `reef_activity` discriminated union. Used by
 * `reconstructEvents`, which consults logged status transitions when
 * deciding whether to synthesize a fallback current-status / closed event.
 */
type StatusChangeActivityEvent = Extract<
  ActivityEvent,
  { event_type: typeof ACTIVITY_EVENT_STATUS_CHANGE }
>;

function isStatusChangeEvent(
  event: ActivityEvent,
): event is StatusChangeActivityEvent {
  return event.event_type === ACTIVITY_EVENT_STATUS_CHANGE;
}

/**
 * Pure model for the unified activity timeline (REEF-064).
 *
 * The three sources — comments (`reef_comments`), activity events
 * (`reef_activity`), and *reconstructed* events synthesized from the issue's own
 * fields — are merged at read time into one chronological feed. No new storage
 * and no unified table (AC4): this module reshapes data already loaded.
 *
 * Reconstructed events backfill issues that predate the activity log (AC5):
 * `created`, each `delivery` ref, and the issue's current status. For an open
 * issue the status reconstruction is a *fallback* `status_change` — dropped when
 * `reef_activity` already logged that transition (activity wins), so a single
 * change does not show twice. For a closed issue it is a `closed` event carrying
 * the closure reason; because the logged `{from,to}` payload has no reason, the
 * `closed` reconstruction instead *supersedes* the logged plain close, so the
 * close still shows exactly once but with its reason intact.
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
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "assignee_change";
      /** `assigned_to` either side (login), null for an (un)assign edge. */
      from: string | null;
      to: string | null;
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "priority_change";
      from: Priority | null;
      to: Priority | null;
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "planning_link";
      /** Which planning dimension moved (milestone / sprint / release). */
      field: PlanningLinkField;
      /** Planning ids; null on an attach (`null → id`) or detach (`id → null`). */
      from: string | null;
      to: string | null;
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "title_change";
      /** Both ends carry the human title (a rename, does not null). */
      from: string;
      to: string;
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "labels_change";
      /** Labels added / removed in one save (an unordered set change). */
      added: string[];
      removed: string[];
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "due_date_change";
      /** ISO date either side; null on a set (`null → date`) or clear (`date → null`). */
      from: string | null;
      to: string | null;
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "estimate_change";
      /** Story points either side; null on a set or clear. */
      from: number | null;
      to: number | null;
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "parent_change";
      /** Parent reef id (REEF-012); null on an attach or detach. */
      from: string | null;
      to: string | null;
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "relation_change";
      /** Which relation moved (depends_on / blocks / related_to). */
      relation: RelationField;
      /** Related reef ids added / removed in one save. */
      added: string[];
      removed: string[];
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "archived_change";
      /** Archive `false → true`, restore `true → false`. */
      from: boolean;
      to: boolean;
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "attachment_added";
      attachmentId: string;
      filename: string;
      fileUri: string;
      mimeType: string;
      sizeBytes: number;
    }
  | {
      id: string;
      at: string;
      actor: string | null;
      kind: "attachment_removed";
      attachmentId: string;
      filename: string;
      fileUri: string;
      mimeType: string;
      sizeBytes: number;
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
 * into a single expandable row. MVP keeps the rule deliberately simple: just
 * same-kind status-change runs collapse (AC3); `created` / `delivery` / `closed`
 * each carry unique information and does not fold.
 */
const COLLAPSE_THRESHOLD = 3;

/**
 * Map a `reef_activity` row to a normalized system event (REEF-276 / REEF-277).
 * Each field-change kind — status / assignee / priority / planning link, plus the
 * REEF-277 parity set (title, labels, due date, estimate, parent, relations,
 * archive) — becomes its own timeline row. `impl_ref_linked` maps to `null`: a
 * linked delivery ref is already surfaced as a reconstructed `delivery` event
 * from the issue's own `implementation_refs`, so rendering the activity row too
 * would double the delivery line (AC4). The discriminated union narrows `payload`
 * per case.
 */
function fromActivityEvent(event: ActivityEvent): TimelineSystemEvent | null {
  const base = { id: event.id, at: event.at, actor: event.actor };
  switch (event.event_type) {
    case ACTIVITY_EVENT_STATUS_CHANGE:
      return {
        ...base,
        kind: "status_change",
        from: event.payload.from,
        to: event.payload.to,
        source: event.source,
      };
    case ACTIVITY_EVENT_ASSIGNEE_CHANGE:
      return {
        ...base,
        kind: "assignee_change",
        from: event.payload.from,
        to: event.payload.to,
      };
    case ACTIVITY_EVENT_PRIORITY_CHANGE:
      return {
        ...base,
        kind: "priority_change",
        from: event.payload.from,
        to: event.payload.to,
      };
    case ACTIVITY_EVENT_PLANNING_LINK:
      return {
        ...base,
        kind: "planning_link",
        field: event.payload.field,
        from: event.payload.from,
        to: event.payload.to,
      };
    case ACTIVITY_EVENT_TITLE_CHANGE:
      return {
        ...base,
        kind: "title_change",
        from: event.payload.from,
        to: event.payload.to,
      };
    case ACTIVITY_EVENT_LABELS_CHANGE:
      return {
        ...base,
        kind: "labels_change",
        added: event.payload.added,
        removed: event.payload.removed,
      };
    case ACTIVITY_EVENT_DUE_DATE_CHANGE:
      return {
        ...base,
        kind: "due_date_change",
        from: event.payload.from,
        to: event.payload.to,
      };
    case ACTIVITY_EVENT_ESTIMATE_CHANGE:
      return {
        ...base,
        kind: "estimate_change",
        from: event.payload.from,
        to: event.payload.to,
      };
    case ACTIVITY_EVENT_PARENT_CHANGE:
      return {
        ...base,
        kind: "parent_change",
        from: event.payload.from,
        to: event.payload.to,
      };
    case ACTIVITY_EVENT_RELATION_CHANGE:
      return {
        ...base,
        kind: "relation_change",
        relation: event.payload.relation,
        added: event.payload.added,
        removed: event.payload.removed,
      };
    case ACTIVITY_EVENT_ARCHIVED_CHANGE:
      return {
        ...base,
        kind: "archived_change",
        from: event.payload.from,
        to: event.payload.to,
      };
    case ACTIVITY_EVENT_ATTACHMENT_ADDED:
      return {
        ...base,
        kind: "attachment_added",
        attachmentId: event.payload.attachment_id,
        filename: event.payload.filename,
        fileUri: event.payload.file_uri,
        mimeType: event.payload.mime_type,
        sizeBytes: event.payload.size_bytes,
      };
    case ACTIVITY_EVENT_ATTACHMENT_REMOVED:
      return {
        ...base,
        kind: "attachment_removed",
        attachmentId: event.payload.attachment_id,
        filename: event.payload.filename,
        fileUri: event.payload.file_uri,
        mimeType: event.payload.mime_type,
        sizeBytes: event.payload.size_bytes,
      };
    case ACTIVITY_EVENT_IMPL_REF_LINKED:
      // Delivery is reconstructed from the issue's implementation_refs; the
      // activity row would render a second, duplicate delivery line (AC4).
      return null;
  }
}

/** Stable de-dupe key for a delivery ref (vault-skill `type:repo:ref`). */
function deliveryId(ref: ImplementationRef): string {
  return `delivery:${ref.type}:${ref.repo ?? ""}:${ref.ref}`;
}

/**
 * Synthesize events from the issue's own fields (AC5). `created` and each
 * `delivery` ref are consistently emitted — the activity-log MVP records neither, so
 * they does not duplicate a logged event. The status-derived event is a `closed`
 * (with reason) when the issue is closed — consistently emitted, and superseding the
 * logged plain close in `buildEntries` — or otherwise a `status_change` fallback
 * dropped when an activity event already shares its timestamp. Either is skipped
 * when it coincides with creation, since `created` already represents that state.
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

  // The current-status event (AC5). For a closed issue it is a `closed` event
  // carrying the reason — information the logged `{from,to}` payload lacks — so it
  // is Consistently emitted and instead *supersedes* the logged close in `buildEntries`
  // (the close shows once, with its reason). For an open issue it is a plain
  // status_change to the current status, a fallback dropped when reef_activity
  // already logged that transition (activity wins). Either way it is skipped when
  // it coincides with creation, since `created` already represents that state.
  const statusChanges = activity.filter(isStatusChangeEvent);
  const closedAt = closedReconstructionAt(issue);
  if (closedAt != null) {
    // Prefer the logged close's authoritative actor. Otherwise fall back to
    // `updated_by` when it reliably names the closer (see `reliableActorAt`),
    // does not to a later unrelated editor.
    const loggedClose = statusChanges.find(
      (event) => event.payload.to === "closed" && event.at === closedAt,
    );
    events.push({
      id: "current-status",
      at: closedAt,
      actor: loggedClose?.actor ?? reliableActorAt(issue, closedAt),
      kind: "closed",
      reason: issue.closed_reason ?? null,
    });
  } else if (issue.status !== "closed") {
    const statusAt = issue.last_status_change;
    const loggedAtStatusTime =
      statusAt != null && statusChanges.some((event) => event.at === statusAt);
    if (
      statusAt != null &&
      statusAt !== issue.created_at &&
      !loggedAtStatusTime
    ) {
      events.push({
        id: "current-status",
        at: statusAt,
        actor: reliableActorAt(issue, statusAt),
        kind: "status_change",
        from: null,
        to: issue.status,
        source: null,
      });
    }
  }

  return events;
}

/**
 * `updated_by` identifies who made the *last* edit, not specifically who changed
 * the status. It names the transitioner/closer when the status change was
 * the issue's most recent edit — i.e. `updated_at` still equals the transition
 * time. A later non-status edit bumps `updated_by`/`updated_at` without touching
 * the status, so trusting it then would misattribute the reconstructed event to
 * that editor; return null instead so the row stays an honest record.
 */
function reliableActorAt(issue: IssueMetadata, at: string): string | null {
  return issue.updated_at === at ? issue.updated_by || null : null;
}

/**
 * The timestamp of the close that the reconstructed `closed` event represents
 * (and supersedes in the activity log), or null when the issue is not closed or
 * the close coincides with creation. Both `reconstructEvents` and `buildEntries`
 * derive the close from this single source so they stay in lockstep.
 */
function closedReconstructionAt(issue: IssueMetadata): string | null {
  if (issue.status !== "closed") return null;
  const at = issue.closed_at ?? issue.last_status_change ?? null;
  return at != null && at !== issue.created_at ? at : null;
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

  // A logged plain close is superseded by the reconstructed `closed` event, which
  // carries the closure reason the `{from,to}` payload lacks (AC5) — the close
  // renders once, with its reason, instead of as a generic "→ Closed" row.
  const supersededCloseAt = closedReconstructionAt(issue);

  for (const comment of comments) {
    entries.push({ type: "comment", at: comment.created_at, comment });
  }
  // De-dupe activity by event_key, keeping the first server-ordered row. The
  // append path is idempotent on event_key but akb's HTTP surface has no unique
  // index, so two simultaneous identical inserts can leave duplicate rows; the
  // adapter documents that the timeline is the downstream de-duper (REEF-125).
  // Every recorded event kind renders (REEF-276) — status_change, assignee /
  // priority / planning changes — except impl_ref_linked, which `fromActivityEvent`
  // drops to null because the delivery line is reconstructed from the issue's
  // own refs (AC4).
  const seenKeys = new Set<string>();
  for (const event of activity) {
    if (seenKeys.has(event.event_key)) continue;
    seenKeys.add(event.event_key);
    const systemEvent = fromActivityEvent(event);
    if (!systemEvent) continue;
    // A logged plain close (status_change → closed) is superseded by the
    // reconstructed `closed` event, which carries the closure reason the
    // `{from,to}` payload lacks; render the close once, with its reason.
    if (
      systemEvent.kind === "status_change" &&
      supersededCloseAt != null &&
      systemEvent.to === "closed" &&
      systemEvent.at === supersededCloseAt
    ) {
      continue;
    }
    entries.push({ type: "system", at: event.at, event: systemEvent });
  }
  for (const event of reconstructEvents(issue, activity)) {
    entries.push({ type: "system", at: event.at, event });
  }

  return entries.sort((a, b) => {
    // Compare instants, not raw strings: the ISO schema accepts offsets like
    // `+09:00` / `+00:00`, which are not lexicographically ordered by time, so a
    // string compare would misorder valid timestamps across the three sources.
    // (`|| 0` keeps an unparseable value deterministic rather than poisoning the
    // sort with NaN.)
    const ta = Date.parse(a.at) || 0;
    const tb = Date.parse(b.at) || 0;
    if (ta !== tb) return ta - tb;
    const rank = entryRank(a) - entryRank(b);
    if (rank !== 0) return rank;
    return entryId(a) < entryId(b) ? -1 : 1;
  });
}

/** True when this system entry is a foldable status-change event. */
function isStatusChange(
  entry: CommentEntry | SystemEntry,
): entry is SystemEntry {
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
