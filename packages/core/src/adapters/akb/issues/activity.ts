import { ZodError } from "zod";
import { SchemaValidationError } from "../../../errors";
import {
  ACTIVITY_EVENT_STATUS_CHANGE,
  type ActivityEvent,
  ActivityEventMetaSchema,
  ActivityEventSchema,
  StatusChangePayloadSchema,
} from "../../../schemas/issues/activity";
import type { Status } from "../../../schemas/issues/metadata";
import {
  type AkbAdapter,
  REEF_ACTIVITY_TABLE,
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
 * Deterministic idempotency key for a status-change event. The same logical
 * transition (same from→to at the same recorded time) yields the same key, so a
 * retried best-effort append de-dupes against the existing row instead of
 * stacking a duplicate event (REEF-125 AC8). `at` is the issue's
 * `last_status_change`: distinct transitions get distinct keys, and re-running
 * the identical `updateIssue` call (same merged patch) reproduces the key.
 */
export function statusChangeEventKey(
  from: string,
  to: string,
  at: string,
): string {
  return `${ACTIVITY_EVENT_STATUS_CHANGE}:${from}->${to}@${at}`;
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

/**
 * Append an immutable `status_change` event to `reef_activity` (REEF-063 AC1).
 * Idempotent on `event_key` (REEF-125 AC8): the insert is guarded by a
 * `WHERE NOT EXISTS` on the same `(reef_id, event_key)` in ONE statement, so the
 * check and the insert share a snapshot — there is no two-round-trip
 * time-of-check/time-of-use window, and a sequential retry of the same logical
 * transition (the realistic best-effort re-run) finds the committed row and adds
 * nothing. Append-only — there is no update path for an event row.
 *
 * Residual: akb's runtime HTTP surface creates tables by column list only and
 * exposes no ALTER/unique-index (REEF-125 — that is why idempotency is keyed on
 * the logical `event_key`, not a DB constraint). So two *simultaneous* inserts of
 * the identical event_key could still both pass `NOT EXISTS`. That requires an
 * identical `(from,to,at)` — i.e. concurrent retries of the very same update — and
 * is de-duplicated downstream on `event_key` by the timeline (REEF-064). A
 * DB-enforced unique index on `(reef_id, event_key)` is an akb-layer follow-up.
 *
 * Provisions the table lazily via `ensureReefTables` so a vault that predates
 * `reef_activity` self-heals on its first status change instead of dropping the
 * event (REEF-125 AC7). The actor/event-time/source live in `meta`; the row's
 * akb auto columns are not reef's source of truth.
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
      const eventKey = statusChangeEventKey(event.from, event.to, event.at);
      const reefId = quoteText(event.reefId, "activity reef_id");
      const key = quoteText(eventKey, "activity event_key");
      const payload = { from: event.from, to: event.to };
      const meta = {
        actor: event.actor,
        at: event.at,
        source: event.source ?? null,
      };
      const columns = ["reef_id", "event_type", "event_key", "payload", "meta"]
        .map(quoteIdent)
        .join(", ");
      const selectValues = [
        reefId,
        quoteText(ACTIVITY_EVENT_STATUS_CHANGE, "activity event_type"),
        key,
        quoteJson(payload),
        quoteJson(meta),
      ].join(", ");
      // Single-statement conditional insert: the `NOT EXISTS` probe and the
      // insert share one snapshot, so an already-recorded transition is skipped
      // atomically (no separate read-then-write race). RETURNING tells us whether
      // a row was actually added.
      const res = await runSql(
        adapter,
        vault,
        `INSERT INTO ${tableRef(
          REEF_ACTIVITY_TABLE,
        )} (${columns}) SELECT ${selectValues} WHERE NOT EXISTS (SELECT 1 FROM ${tableRef(
          REEF_ACTIVITY_TABLE,
        )} WHERE reef_id = ${reefId} AND event_key = ${key}) RETURNING id`,
      );
      span.setAttribute(
        "appended",
        res.kind === "table_query" && res.items.length > 0,
      );
    },
  );
}

/**
 * Map a `reef_activity` row to an ActivityEvent. The reef-semantic actor, event
 * time, and source are projected from `meta` (REEF-125), the transition from
 * `payload`.
 */
function rowToActivityEvent(row: Record<string, unknown>): ActivityEvent {
  try {
    const meta = ActivityEventMetaSchema.parse(
      decodeSettingsValue(row.meta) ?? {},
    );
    const payload = StatusChangePayloadSchema.parse(
      decodeSettingsValue(row.payload) ?? {},
    );
    return ActivityEventSchema.parse({
      id: row.id,
      reef_id: row.reef_id,
      event_type: row.event_type,
      event_key: row.event_key,
      payload,
      actor: meta.actor,
      at: meta.at,
      source: meta.source,
    });
  } catch (err) {
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
