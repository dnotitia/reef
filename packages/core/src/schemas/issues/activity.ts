import { z } from "zod";
import { IsoDateFieldSchema } from "../common/date";
import { StatusEnum } from "./metadata";

/**
 * Issue activity log (REEF-063 / REEF-125).
 *
 * An activity event is an immutable `reef_activity` row recording something that
 * happened to an issue — the Jira changelog / Linear IssueHistory equivalent.
 * The MVP records the single highest-value transition: a `status_change`. Other
 * field events (assignee, priority, planning, delivery refs) are deferred to
 * REEF-126, which widens `payload` into a discriminated union; the timeline
 * render is REEF-064.
 *
 * Storage shape (REEF-125 provisioned the table): every event row carries
 *   reef_id    — the issue the event belongs to
 *   event_type — `status_change` today
 *   event_key  — idempotency key; the same logical transition retried carries
 *                the same key so a best-effort append never doubles a row
 *   payload    — event-specific data (`{ from, to }` for a status change)
 *   meta       — reef-semantic audit (actor, event time, trigger source), NOT
 *                akb's auto `created_by`/`created_at` (REEF-125 decision)
 */
export const ACTIVITY_EVENT_STATUS_CHANGE = "status_change";

/** `reef_activity.payload` for a `status_change` event: the from→to transition. */
export const StatusChangePayloadSchema = z.object({
  from: StatusEnum,
  to: StatusEnum,
});
export type StatusChangePayload = z.infer<typeof StatusChangePayloadSchema>;

/**
 * `reef_activity.meta` json contract. akb auto-injects `id`/`created_by`/
 * `created_at`/`updated_at` on the row, but those are the akb auth principal and
 * akb bookkeeping — the reef-semantic actor, the event's own timestamp, and its
 * trigger provenance live here in `meta` (mirrors `CommentMetaSchema`).
 *
 *   actor  — reef semantic actor (akb username) who caused the event.
 *   at     — ISO-8601 event time; for a status change this is the issue's
 *            `last_status_change`, so the event and the issue's last-change
 *            marker agree.
 *   source — trigger provenance (e.g. `ai-agent:status_change:<id>`), or null.
 */
export const ActivityEventMetaSchema = z.object({
  actor: z.string().min(1, "activity actor is required"),
  at: IsoDateFieldSchema,
  source: z.string().nullable().default(null),
});
export type ActivityEventMeta = z.infer<typeof ActivityEventMetaSchema>;

/**
 * An activity event as it crosses the core boundary. Wire fields are snake_case
 * (the akb row shape); `id` is the akb-assigned uuid; `actor`/`at`/`source` are
 * projected from `meta`, never from akb's auto columns. `payload` is the
 * status-change transition — the only event kind today (REEF-126 generalizes).
 */
export const ActivityEventSchema = z.object({
  id: z.string().min(1, "activity id is required"),
  reef_id: z.string().min(1, "reef_id is required"),
  event_type: z.string().min(1, "event_type is required"),
  event_key: z.string().min(1, "event_key is required"),
  payload: StatusChangePayloadSchema,
  actor: z.string().min(1, "activity actor is required"),
  at: IsoDateFieldSchema,
  source: z.string().nullable().default(null),
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

/**
 * An activity event projected for the cross-issue Activity feed (REEF-077): an
 * `ActivityEvent` plus the owning issue's current `title`, joined in at read time
 * so the feed renders the issue link + title without an N+1 lookup per event.
 *
 * This is the vault-wide "what changed since you were last here" projection the
 * Activity hub merges with the AI review inbox — distinct from
 * `listIssueActivity`, which returns a single issue's full history for the
 * REEF-064 detail timeline.
 */
export const RecentActivityEventSchema = ActivityEventSchema.extend({
  issue_title: z.string().min(1, "issue_title is required"),
});
export type RecentActivityEvent = z.infer<typeof RecentActivityEventSchema>;

/** `/api/activity/events` response — the vault-wide recent issue-change feed. */
export const RecentActivityResultSchema = z.object({
  events: z.array(RecentActivityEventSchema),
});
export type RecentActivityResult = z.infer<typeof RecentActivityResultSchema>;
