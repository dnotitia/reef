import { ZodError } from "zod";
import { SchemaValidationError } from "../../../errors";
import {
  ACTIVITY_EVENT_ASSIGNEE_CHANGE,
  ACTIVITY_EVENT_IMPL_REF_LINKED,
  ACTIVITY_EVENT_PLANNING_LINK,
  ACTIVITY_EVENT_PRIORITY_CHANGE,
  ACTIVITY_EVENT_STATUS_CHANGE,
  type ActivityEvent,
  ActivityEventMetaSchema,
  type ActivityEventPayload,
  ActivityEventSchema,
  type ActivityEventType,
  type AssigneeChangePayload,
  AssigneeChangePayloadSchema,
  type ImplRefLinkedPayload,
  ImplRefLinkedPayloadSchema,
  type PlanningLinkField,
  type PlanningLinkPayload,
  PlanningLinkPayloadSchema,
  type PriorityChangePayload,
  PriorityChangePayloadSchema,
  type RecentActivityEvent,
  RecentActivityEventSchema,
  type StatusChangePayload,
  StatusChangePayloadSchema,
} from "../../../schemas/issues/activity";
import type { IssueMetadata, Status } from "../../../schemas/issues/metadata";
import {
  type AkbAdapter,
  REEF_ACTIVITY_TABLE,
  REEF_ISSUES_TABLE,
  decodeSettingsValue,
  ensureReefTables,
  isMissingTableError,
  quoteIdent,
  quoteJson,
  quoteText,
  runSql,
  tableRef,
  withSpan,
} from "../core/shared";

/**
 * The discriminating `eventType` + its matching `payload`. A distributive
 * discriminated union (one member per event kind) so a `switch` on `eventType`
 * narrows `payload` to the right shape with no casts.
 */
export type ActivityEventDescriptor =
  | {
      eventType: typeof ACTIVITY_EVENT_STATUS_CHANGE;
      payload: StatusChangePayload;
    }
  | {
      eventType: typeof ACTIVITY_EVENT_ASSIGNEE_CHANGE;
      payload: AssigneeChangePayload;
    }
  | {
      eventType: typeof ACTIVITY_EVENT_PRIORITY_CHANGE;
      payload: PriorityChangePayload;
    }
  | {
      eventType: typeof ACTIVITY_EVENT_PLANNING_LINK;
      payload: PlanningLinkPayload;
    }
  | {
      eventType: typeof ACTIVITY_EVENT_IMPL_REF_LINKED;
      payload: ImplRefLinkedPayload;
    };

/**
 * One activity event ready to append: a descriptor plus the shared
 * `reefId`/`at`/`actor`/`source` audit fields. Intersecting the union with the
 * shared fields distributes, so this stays a discriminated union.
 */
export type ActivityEventInput = ActivityEventDescriptor & {
  reefId: string;
  /** ISO-8601 event time — see `at` in `ActivityEventMetaSchema`. */
  at: string;
  /** reef semantic actor who caused the change (the issue's `updated_by`). */
  actor: string;
  /** Trigger provenance (the issue's `meta.source`), or null. */
  source: string | null;
};

/** Render a nullable key segment so an attach/detach never collides with a value. */
function eventKeySegment(value: string | null): string {
  return value ?? "∅";
}

/**
 * Deterministic idempotency key for an activity event. The same logical change
 * (same discriminant + from→to at the same recorded time) yields the same key,
 * so a retried best-effort append de-dupes against the existing row instead of
 * stacking a duplicate (REEF-125 AC8). `at` ties the key to the update that
 * produced it, so a literal re-run of the identical `updateIssue` call (same
 * merged patch, same timestamp) reproduces the key while two separate edits get
 * distinct keys.
 */
export function activityEventKey(
  descriptor: ActivityEventDescriptor,
  at: string,
): string {
  switch (descriptor.eventType) {
    case ACTIVITY_EVENT_PLANNING_LINK: {
      const { field, from, to } = descriptor.payload;
      return `${descriptor.eventType}:${field}:${eventKeySegment(from)}->${eventKeySegment(to)}@${at}`;
    }
    case ACTIVITY_EVENT_IMPL_REF_LINKED: {
      const { ref_type, repo, ref } = descriptor.payload;
      return `${descriptor.eventType}:${ref_type}:${eventKeySegment(repo)}:${ref}@${at}`;
    }
    default: {
      // status_change / assignee_change / priority_change all key on from→to.
      const { from, to } = descriptor.payload;
      return `${descriptor.eventType}:${eventKeySegment(from)}->${eventKeySegment(to)}@${at}`;
    }
  }
}

/**
 * Back-compat status-change key (REEF-063). Delegates to `activityEventKey` so
 * the key format has a single source; status enum values are never null, so the
 * segments render verbatim (`status_change:todo->in_progress@<at>`).
 */
export function statusChangeEventKey(
  from: string,
  to: string,
  at: string,
): string {
  return activityEventKey(
    {
      eventType: ACTIVITY_EVENT_STATUS_CHANGE,
      payload: { from, to } as StatusChangePayload,
    },
    at,
  );
}

export interface StatusChangeEventInput {
  reefId: string;
  from: Status;
  to: Status;
  /** ISO-8601 transition time — the issue's `last_status_change`. */
  at: string;
  /** reef semantic actor who caused the change (the issue's `updated_by`). */
  actor: string;
  /** Trigger provenance (the issue's `meta.source`), or null. */
  source?: string | null;
}

interface ActivityRowInput {
  reefId: string;
  eventType: ActivityEventType;
  eventKey: string;
  payload: ActivityEventPayload;
  meta: { actor: string; at: string; source: string | null };
}

/**
 * Append one immutable event row to `reef_activity`, idempotent on
 * `(reef_id, event_key)` (REEF-125 AC8). The `NOT EXISTS` probe and the insert
 * share ONE statement, so the check and the insert see one snapshot — no
 * two-round-trip time-of-check/time-of-use window — and a sequential retry of
 * the same logical change finds the committed row and adds nothing. Append-only:
 * there is no update path for an event row. Returns whether a row was added.
 *
 * Residual: akb's runtime HTTP surface creates tables by column list only and
 * exposes no ALTER/unique-index (REEF-125), so two *simultaneous* inserts of the
 * identical event_key could both pass `NOT EXISTS`. That needs concurrent
 * retries of the very same update; it is de-duplicated downstream on `event_key`
 * by the timeline (REEF-064). A DB-enforced unique index is an akb-layer
 * follow-up. Callers `ensureReefTables` first so a vault predating the table
 * self-heals on first write (REEF-125 AC7).
 */
async function insertActivityEventRow(
  adapter: AkbAdapter,
  vault: string,
  row: ActivityRowInput,
): Promise<boolean> {
  const reefId = quoteText(row.reefId, "activity reef_id");
  const key = quoteText(row.eventKey, "activity event_key");
  const columns = ["reef_id", "event_type", "event_key", "payload", "meta"]
    .map(quoteIdent)
    .join(", ");
  const selectValues = [
    reefId,
    quoteText(row.eventType, "activity event_type"),
    key,
    quoteJson(row.payload),
    quoteJson(row.meta),
  ].join(", ");
  // Single-statement conditional insert: the `NOT EXISTS` probe and the insert
  // share one snapshot, so an already-recorded change is skipped atomically (no
  // separate read-then-write race). RETURNING tells us whether a row was added.
  const res = await runSql(
    adapter,
    vault,
    `INSERT INTO ${tableRef(
      REEF_ACTIVITY_TABLE,
    )} (${columns}) SELECT ${selectValues} WHERE NOT EXISTS (SELECT 1 FROM ${tableRef(
      REEF_ACTIVITY_TABLE,
    )} WHERE reef_id = ${reefId} AND event_key = ${key}) RETURNING id`,
  );
  return res.kind === "table_query" && res.items.length > 0;
}

/**
 * Append an immutable `status_change` event to `reef_activity` (REEF-063 AC1).
 *
 * The caller (`updateIssue`) runs this best-effort: the status row update has
 * already committed, so a failed append must not fail the whole update —
 * `last_status_change` remains the last-resort single-event safety net (AC5).
 */
export async function appendStatusChangeEvent(
  adapter: AkbAdapter,
  vault: string,
  event: StatusChangeEventInput,
): Promise<void> {
  return withSpan(
    "akb.append_status_change_event",
    { vault, reef_id: event.reefId },
    async (span) => {
      await ensureReefTables({ adapter, vault });
      const appended = await insertActivityEventRow(adapter, vault, {
        reefId: event.reefId,
        eventType: ACTIVITY_EVENT_STATUS_CHANGE,
        eventKey: statusChangeEventKey(event.from, event.to, event.at),
        payload: { from: event.from, to: event.to },
        meta: {
          actor: event.actor,
          at: event.at,
          source: event.source ?? null,
        },
      });
      span.setAttribute("appended", appended);
    },
  );
}

/**
 * Append a batch of non-status field-change events (REEF-126) in one funnel.
 * Provisions the table once, then inserts each event idempotently. Like
 * `appendStatusChangeEvent` the caller runs this best-effort — the row UPDATE
 * already committed, so a failed append must never fail the issue update.
 */
export async function appendActivityEvents(
  adapter: AkbAdapter,
  vault: string,
  events: ActivityEventInput[],
): Promise<void> {
  const [first] = events;
  if (!first) {
    return;
  }
  return withSpan(
    "akb.append_activity_events",
    { vault, reef_id: first.reefId, count: events.length },
    async (span) => {
      await ensureReefTables({ adapter, vault });
      let appended = 0;
      for (const event of events) {
        const ok = await insertActivityEventRow(adapter, vault, {
          reefId: event.reefId,
          eventType: event.eventType,
          eventKey: activityEventKey(event, event.at),
          payload: event.payload,
          meta: {
            actor: event.actor,
            at: event.at,
            source: event.source,
          },
        });
        if (ok) {
          appended += 1;
        }
      }
      span.setAttribute("appended_count", appended);
    },
  );
}

/** Stable identity of an implementation ref, matching the runbook's `type:repo:ref` de-dupe. */
function implRefDedupeKey(ref: {
  type: string;
  repo?: string;
  ref: string;
}): string {
  return `${ref.type}:${ref.repo ?? ""}:${ref.ref}`;
}

/**
 * Derive the non-status field-change events for one `updateIssue` (REEF-126).
 * Pure: compares the pre-update snapshot against the merged result and emits one
 * event per changed dimension — assignee, priority, each planning link, and each
 * newly-linked delivery ref. status_change is NOT emitted here; it keeps its own
 * funnel keyed on `last_status_change`. Every event shares the one `meta.at`
 * timestamp so a multi-field save groups under a single instant (AC3).
 */
export function diffFieldActivityEvents(
  reefId: string,
  before: IssueMetadata,
  after: IssueMetadata,
  meta: { at: string; actor: string; source: string | null },
): ActivityEventInput[] {
  const events: ActivityEventInput[] = [];
  const base = {
    reefId,
    at: meta.at,
    actor: meta.actor,
    source: meta.source,
  };

  const assigneeFrom = before.assigned_to ?? null;
  const assigneeTo = after.assigned_to ?? null;
  if (assigneeFrom !== assigneeTo) {
    events.push({
      ...base,
      eventType: ACTIVITY_EVENT_ASSIGNEE_CHANGE,
      payload: { from: assigneeFrom, to: assigneeTo },
    });
  }

  const priorityFrom = before.priority ?? null;
  const priorityTo = after.priority ?? null;
  if (priorityFrom !== priorityTo) {
    events.push({
      ...base,
      eventType: ACTIVITY_EVENT_PRIORITY_CHANGE,
      payload: { from: priorityFrom, to: priorityTo },
    });
  }

  const planningDimensions: ReadonlyArray<{
    field: PlanningLinkField;
    from: string | null;
    to: string | null;
  }> = [
    {
      field: "milestone",
      from: before.milestone_id ?? null,
      to: after.milestone_id ?? null,
    },
    {
      field: "sprint",
      from: before.sprint_id ?? null,
      to: after.sprint_id ?? null,
    },
    {
      field: "release",
      from: before.release_id ?? null,
      to: after.release_id ?? null,
    },
  ];
  for (const dimension of planningDimensions) {
    if (dimension.from !== dimension.to) {
      events.push({
        ...base,
        eventType: ACTIVITY_EVENT_PLANNING_LINK,
        payload: {
          field: dimension.field,
          from: dimension.from,
          to: dimension.to,
        },
      });
    }
  }

  const linkedBefore = new Set(
    (before.implementation_refs ?? []).map(implRefDedupeKey),
  );
  for (const ref of after.implementation_refs ?? []) {
    if (!linkedBefore.has(implRefDedupeKey(ref))) {
      events.push({
        ...base,
        eventType: ACTIVITY_EVENT_IMPL_REF_LINKED,
        payload: { ref_type: ref.type, ref: ref.ref, repo: ref.repo ?? null },
      });
    }
  }

  return events;
}

/** The per-event-type payload validator, keyed by the row's `event_type` discriminant. */
const PAYLOAD_SCHEMA_BY_EVENT_TYPE = {
  [ACTIVITY_EVENT_STATUS_CHANGE]: StatusChangePayloadSchema,
  [ACTIVITY_EVENT_ASSIGNEE_CHANGE]: AssigneeChangePayloadSchema,
  [ACTIVITY_EVENT_PRIORITY_CHANGE]: PriorityChangePayloadSchema,
  [ACTIVITY_EVENT_PLANNING_LINK]: PlanningLinkPayloadSchema,
  [ACTIVITY_EVENT_IMPL_REF_LINKED]: ImplRefLinkedPayloadSchema,
} as const;

/**
 * Map a `reef_activity` row to an ActivityEvent. The reef-semantic actor, event
 * time, and source are projected from `meta` (REEF-125); the `payload` is parsed
 * by the schema for this row's `event_type` (REEF-126). An unknown/future
 * event_type this release can't model is treated as malformed so the read path
 * skips it rather than surfacing an untyped payload.
 */
function rowToActivityEvent(row: Record<string, unknown>): ActivityEvent {
  try {
    const meta = ActivityEventMetaSchema.parse(
      decodeSettingsValue(row.meta) ?? {},
    );
    const eventType = row.event_type;
    const payloadSchema =
      typeof eventType === "string"
        ? PAYLOAD_SCHEMA_BY_EVENT_TYPE[eventType as ActivityEventType]
        : undefined;
    if (!payloadSchema) {
      throw new SchemaValidationError({
        issues: [`unknown activity event_type: ${String(eventType)}`],
      });
    }
    const payload = payloadSchema.parse(decodeSettingsValue(row.payload) ?? {});
    return ActivityEventSchema.parse({
      id: row.id,
      reef_id: row.reef_id,
      event_type: eventType,
      event_key: row.event_key,
      payload,
      actor: meta.actor,
      at: meta.at,
      source: meta.source,
    });
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw err;
    }
    if (err instanceof ZodError) {
      throw new SchemaValidationError({
        issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    throw new SchemaValidationError({
      issues: ["Activity event row validation failed"],
    });
  }
}

/**
 * List an issue's activity events oldest-first (REEF-063 Notes: events are
 * queryable per issue). Orders by the semantic `meta.at` (ISO-8601 sorts
 * lexically), with the akb uuid `id` as a stable tiebreak. The timeline render
 * that consumes this is REEF-064.
 *
 * Read-path resilience mirrors `listComments`: an unprovisioned vault (no
 * `reef_activity` table) reads as an empty history WITHOUT reconciling — a read
 * never provisions (REEF-125 AC9). A single malformed row is skipped rather than
 * blanking the whole history.
 */
export async function listIssueActivity(
  adapter: AkbAdapter,
  vault: string,
  reefId: string,
): Promise<ActivityEvent[]> {
  return withSpan(
    "akb.list_issue_activity",
    { vault, reef_id: reefId },
    async (span) => {
      let rows: Record<string, unknown>[];
      try {
        const res = await runSql(
          adapter,
          vault,
          `SELECT * FROM ${tableRef(REEF_ACTIVITY_TABLE)} WHERE reef_id = ${quoteText(
            reefId,
            "activity reef_id",
          )} ORDER BY meta->>'at' ASC, id ASC`,
        );
        rows = res.kind === "table_query" ? res.items : [];
      } catch (err) {
        if (isMissingTableError(err)) {
          span.setAttribute("table_exists", false);
          return [];
        }
        throw err;
      }
      const events: ActivityEvent[] = [];
      for (const row of rows) {
        try {
          events.push(rowToActivityEvent(row));
        } catch {
          // Skip a malformed event row rather than failing the whole history.
        }
      }
      span.setAttribute("event_count", events.length);
      return events;
    },
  );
}

/** Default cap on how many recent events the cross-issue feed pulls per read. */
const RECENT_ACTIVITY_DEFAULT_LIMIT = 100;
/** Hard upper bound so a caller-supplied limit can never unbounded the query. */
const RECENT_ACTIVITY_MAX_LIMIT = 500;

export interface ListRecentActivityOptions {
  /**
   * ISO-8601 lower bound (exclusive) on `meta.at` — only events strictly after
   * this are returned. This is the Activity hub's `last_visit_at` marker; omit
   * for no lower bound.
   */
  since?: string;
  /** Cap on the number of events returned, newest first (clamped to a max). */
  limit?: number;
}

/**
 * Map a JOINed `reef_activity` + `reef_issues.title` row to a RecentActivityEvent.
 * Reuses `rowToActivityEvent` for the event projection, then attaches the owning
 * issue's title so the feed renders the issue link without an N+1 lookup.
 */
function rowToRecentActivityEvent(
  row: Record<string, unknown>,
): RecentActivityEvent {
  const base = rowToActivityEvent(row);
  return RecentActivityEventSchema.parse({
    ...base,
    issue_title: row.issue_title,
  });
}

/**
 * List recent issue activity events across the whole vault, newest-first, for
 * the cross-issue Activity feed (REEF-077). Each event is joined to its issue's
 * current `title` so the hub can render an issue link + title in one round trip.
 *
 * This is the vault-wide companion to `listIssueActivity` (one issue's full
 * history). The Activity hub merges these informational change events with the
 * AI review inbox to answer "what changed since you were last here", so the read
 * is bounded by an optional `since` marker and a hard `limit`.
 *
 * Read-path resilience mirrors `listIssueActivity`: an unprovisioned vault (no
 * `reef_activity` table) reads as an empty feed WITHOUT reconciling — a read
 * never provisions (REEF-125 AC9). A single malformed row is skipped rather than
 * blanking the whole feed. The inner JOIN drops events whose issue row no longer
 * exists, which is the desired behavior (a change to a deleted issue has nothing
 * to link to).
 */
export async function listRecentActivity(
  adapter: AkbAdapter,
  vault: string,
  options: ListRecentActivityOptions = {},
): Promise<RecentActivityEvent[]> {
  const limit = Math.min(
    Math.max(1, Math.trunc(options.limit ?? RECENT_ACTIVITY_DEFAULT_LIMIT)),
    RECENT_ACTIVITY_MAX_LIMIT,
  );
  return withSpan("akb.list_recent_activity", { vault }, async (span) => {
    const sinceClause = options.since
      ? ` WHERE a.meta->>'at' > ${quoteText(options.since, "activity since")}`
      : "";
    let rows: Record<string, unknown>[];
    try {
      const res = await runSql(
        adapter,
        vault,
        `SELECT a.*, i.title AS issue_title FROM ${tableRef(
          REEF_ACTIVITY_TABLE,
        )} a JOIN ${tableRef(
          REEF_ISSUES_TABLE,
        )} i ON i.reef_id = a.reef_id${sinceClause} ORDER BY a.meta->>'at' DESC, a.id DESC LIMIT ${limit}`,
      );
      rows = res.kind === "table_query" ? res.items : [];
    } catch (err) {
      if (isMissingTableError(err)) {
        span.setAttribute("table_exists", false);
        return [];
      }
      throw err;
    }
    const events: RecentActivityEvent[] = [];
    for (const row of rows) {
      try {
        events.push(rowToRecentActivityEvent(row));
      } catch {
        // Skip a malformed row rather than blanking the whole feed.
      }
    }
    span.setAttribute("event_count", events.length);
    return events;
  });
}
