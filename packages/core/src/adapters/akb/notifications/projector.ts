import { ZodError, z } from "zod";
import { SchemaValidationError } from "../../../errors";
import { observe } from "../../../observability";
import {
  type Notification,
  type Subscription,
  effectiveSubscriptionState,
} from "../../../schemas/notifications";
import {
  type AkbAdapter,
  REEF_ACTIVITY_TABLE,
  REEF_COMMENTS_TABLE,
  REEF_SETTINGS_NOTIFICATION_PROJECTOR_V1_KEY,
  REEF_SETTINGS_TABLE,
  decodeSettingsValue,
  quoteJson,
  quoteText,
  runSql,
  tableRef,
  withSpan,
} from "../core/shared";
import { createNotification, listSubscriptions } from "./notifications";

const ProjectorCursorSchema = z
  .object({ occurred_at: z.string().min(1), id: z.string() })
  .strict();

export const NotificationProjectorStateSchema = z
  .object({
    version: z.literal(1),
    enabled_at: z.string().datetime({ offset: true }),
    activity: ProjectorCursorSchema,
    comment: ProjectorCursorSchema,
  })
  .strict();

export const NotificationProjectorTickInputSchema = z
  .object({
    vault: z.string().trim().min(1),
    pageSize: z.number().int().min(1).max(100).default(50),
    signal: z.instanceof(AbortSignal).optional(),
    now: z.function().returns(z.date()).optional(),
  })
  .strict();

export type NotificationProjectorState = z.infer<
  typeof NotificationProjectorStateSchema
>;
export type NotificationProjectorTickInput = z.input<
  typeof NotificationProjectorTickInputSchema
>;

export interface NotificationProjectorSourceResult {
  scanned: number;
  malformed: number;
  delivered: number;
  skipped: number;
  retried: number;
  checkpoint: ProjectorCursor;
}

export interface NotificationProjectorTickResult {
  activated: boolean;
  activity: NotificationProjectorSourceResult;
  comment: NotificationProjectorSourceResult;
}

interface ProjectorCursor {
  occurred_at: string;
  id: string;
}

type SourceName = "activity" | "comment";

interface SourceEvent {
  source: SourceName;
  cursor: ProjectorCursor;
  reefId: string;
  sourceRef: string;
  eventType: string;
  actor: string;
  occurredAt: string;
  payload: unknown;
  provenance: Record<string, unknown>;
}

interface RawSourceRow extends Record<string, unknown> {
  id?: unknown;
  reef_id?: unknown;
  event_type?: unknown;
  event_key?: unknown;
  payload?: unknown;
  meta?: unknown;
  projector_sort_at?: unknown;
}

const emptySourceResult = (
  checkpoint: ProjectorCursor,
): NotificationProjectorSourceResult => ({
  scanned: 0,
  malformed: 0,
  delivered: 0,
  skipped: 0,
  retried: 0,
  checkpoint,
});

function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isoDateTime(value: unknown): string | null {
  const parsed = z.string().datetime({ offset: true }).safeParse(value);
  return parsed.success ? parsed.data : null;
}

function stateError(): SchemaValidationError {
  return new SchemaValidationError({
    issues: ["Notification projector state is invalid"],
  });
}

function inputError(error: ZodError): SchemaValidationError {
  return new SchemaValidationError({
    clientValidated: true,
    issues: error.issues.map(
      (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
    ),
  });
}

function parseInput(input: NotificationProjectorTickInput): {
  vault: string;
  pageSize: number;
  signal: AbortSignal | undefined;
  now: () => Date;
} {
  try {
    const parsed = NotificationProjectorTickInputSchema.parse(input);
    return {
      vault: parsed.vault,
      pageSize: parsed.pageSize,
      signal: parsed.signal,
      now: parsed.now ?? (() => new Date()),
    };
  } catch (error) {
    if (error instanceof ZodError) throw inputError(error);
    throw error;
  }
}

function cursorFromRaw(row: RawSourceRow): ProjectorCursor | null {
  const occurredAt = nonEmptyString(row.projector_sort_at);
  const id = nonEmptyString(row.id);
  return occurredAt && id ? { occurred_at: occurredAt, id } : null;
}

function mapActivity(
  row: RawSourceRow,
  cursor: ProjectorCursor,
): SourceEvent | null {
  const reefId = nonEmptyString(row.reef_id);
  const sourceRef = nonEmptyString(row.event_key);
  const eventType = nonEmptyString(row.event_type);
  const meta = asObject(decodeSettingsValue(row.meta));
  const actor = nonEmptyString(meta?.actor);
  const occurredAt = isoDateTime(meta?.at);
  if (!reefId || !sourceRef || !eventType || !actor || !occurredAt) return null;
  return {
    source: "activity",
    cursor,
    reefId,
    sourceRef,
    eventType,
    actor,
    occurredAt,
    payload: decodeSettingsValue(row.payload) ?? null,
    provenance: {
      source: "activity",
      event_key: sourceRef,
      source_provenance: meta?.source ?? null,
    },
  };
}

function mapComment(
  row: RawSourceRow,
  cursor: ProjectorCursor,
): SourceEvent | null {
  const reefId = nonEmptyString(row.reef_id);
  const commentId = nonEmptyString(row.id);
  const meta = asObject(decodeSettingsValue(row.meta));
  const actor = nonEmptyString(meta?.author);
  const occurredAt = isoDateTime(meta?.created_at);
  if (!reefId || !commentId || !actor || !occurredAt) return null;
  const payload: Record<string, string> = { comment_id: commentId };
  const parentCommentId = nonEmptyString(meta?.parent_comment_id);
  const threadRootId = nonEmptyString(meta?.thread_root_id);
  if (parentCommentId) payload.parent_comment_id = parentCommentId;
  if (threadRootId) payload.thread_root_id = threadRootId;
  return {
    source: "comment",
    cursor,
    reefId,
    sourceRef: commentId,
    eventType: "comment_created",
    actor,
    occurredAt,
    payload,
    provenance: { source: "comment" },
  };
}

async function readState(
  adapter: AkbAdapter,
  vault: string,
): Promise<NotificationProjectorState | null> {
  const response = await runSql(
    adapter,
    vault,
    `SELECT value FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${quoteText(
      REEF_SETTINGS_NOTIFICATION_PROJECTOR_V1_KEY,
      "notification projector settings key",
    )} LIMIT 1`,
  );
  const row = response.kind === "table_query" ? response.items[0] : undefined;
  if (!row) return null;
  try {
    return NotificationProjectorStateSchema.parse(
      decodeSettingsValue(row.value),
    );
  } catch {
    throw stateError();
  }
}

async function writeState(
  adapter: AkbAdapter,
  vault: string,
  state: NotificationProjectorState,
): Promise<void> {
  await runSql(
    adapter,
    vault,
    `WITH removed AS (DELETE FROM ${tableRef(
      REEF_SETTINGS_TABLE,
    )} WHERE key = ${quoteText(
      REEF_SETTINGS_NOTIFICATION_PROJECTOR_V1_KEY,
      "notification projector settings key",
    )}), inserted AS (INSERT INTO ${tableRef(
      REEF_SETTINGS_TABLE,
    )} (key, value) SELECT ${quoteText(
      REEF_SETTINGS_NOTIFICATION_PROJECTOR_V1_KEY,
      "notification projector settings key",
    )}, ${quoteJson(state)} WHERE (SELECT count(*) FROM removed) >= 0) SELECT 1`,
  );
}

async function readPage(
  adapter: AkbAdapter,
  vault: string,
  source: SourceName,
  cursor: ProjectorCursor,
  pageSize: number,
): Promise<RawSourceRow[]> {
  const table =
    source === "activity" ? REEF_ACTIVITY_TABLE : REEF_COMMENTS_TABLE;
  const sortExpression =
    source === "activity" ? "meta->>'at'" : "meta->>'created_at'";
  const response = await runSql(
    adapter,
    vault,
    `SELECT *, ${sortExpression} AS projector_sort_at FROM ${tableRef(
      table,
    )} WHERE (${sortExpression} > ${quoteText(
      cursor.occurred_at,
      "notification projector cursor time",
    )} OR (${sortExpression} = ${quoteText(
      cursor.occurred_at,
      "notification projector cursor time",
    )} AND id > ${quoteText(cursor.id, "notification projector cursor id")})) ORDER BY ${sortExpression} ASC, id ASC LIMIT ${pageSize}`,
  );
  return response.kind === "table_query" ? response.items : [];
}

function recipientsForEvent(
  subscriptions: Subscription[],
  actor: string,
): string[] {
  const bySubscriber = new Map<string, Subscription[]>();
  for (const subscription of subscriptions) {
    const existing = bySubscriber.get(subscription.subscriber) ?? [];
    existing.push(subscription);
    bySubscriber.set(subscription.subscriber, existing);
  }
  return [...bySubscriber.entries()]
    .filter(
      ([subscriber, rows]) =>
        subscriber !== actor && effectiveSubscriptionState(rows) === "watching",
    )
    .map(([subscriber]) => subscriber)
    .sort();
}

async function checkpointAfter(
  adapter: AkbAdapter,
  vault: string,
  state: NotificationProjectorState,
  source: SourceName,
  cursor: ProjectorCursor,
): Promise<NotificationProjectorState> {
  const next = { ...state, [source]: cursor };
  await writeState(adapter, vault, next);
  return next;
}

async function projectSource(
  adapter: AkbAdapter,
  vault: string,
  source: SourceName,
  initialState: NotificationProjectorState,
  pageSize: number,
  signal: AbortSignal | undefined,
): Promise<{
  state: NotificationProjectorState;
  result: NotificationProjectorSourceResult;
}> {
  let state = initialState;
  const result = emptySourceResult(state[source]);
  if (signal?.aborted) return { state, result };
  const rows = await readPage(adapter, vault, source, state[source], pageSize);
  for (const raw of rows) {
    if (signal?.aborted) break;
    result.scanned += 1;
    const cursor = cursorFromRaw(raw);
    const event = cursor
      ? source === "activity"
        ? mapActivity(raw, cursor)
        : mapComment(raw, cursor)
      : null;
    if (!cursor || !event) {
      result.malformed += 1;
      if (cursor) {
        state = await checkpointAfter(adapter, vault, state, source, cursor);
        result.checkpoint = cursor;
      }
      continue;
    }

    const subscriptions = await listSubscriptions(adapter, vault, {
      reefId: event.reefId,
    });
    const recipients = recipientsForEvent(subscriptions, event.actor);
    for (const recipient of recipients) {
      const notification: Notification = await createNotification(
        adapter,
        vault,
        {
          recipient,
          reefId: event.reefId,
          sourceType: event.source,
          sourceRef: event.sourceRef,
          eventType: event.eventType,
          actor: event.actor,
          occurredAt: event.occurredAt,
          payload: event.payload,
          meta: { provenance: event.provenance },
        },
      );
      if (notification.recipient === recipient) result.delivered += 1;
    }
    if (recipients.length === 0) result.skipped += 1;
    state = await checkpointAfter(adapter, vault, state, source, cursor);
    result.checkpoint = cursor;
  }
  return { state, result };
}

/** Durable, idempotent activity/comment-to-notification projector. */
export async function runNotificationProjector(
  adapter: AkbAdapter,
  input: NotificationProjectorTickInput,
): Promise<NotificationProjectorTickResult> {
  const { vault, pageSize, signal, now } = parseInput(input);
  return withSpan("akb.notifications.projector", { vault }, async (span) => {
    const startedAt = Date.now();
    let state = await readState(adapter, vault);
    if (!state) {
      const enabledAt = now().toISOString();
      state = {
        version: 1,
        enabled_at: enabledAt,
        activity: { occurred_at: enabledAt, id: "" },
        comment: { occurred_at: enabledAt, id: "" },
      };
      await writeState(adapter, vault, state);
      const result: NotificationProjectorTickResult = {
        activated: true,
        activity: emptySourceResult(state.activity),
        comment: emptySourceResult(state.comment),
      };
      observe(
        span,
        {
          source: "all",
          duration_ms: Date.now() - startedAt,
          scanned: 0,
          malformed: 0,
          delivered: 0,
          skipped: 0,
          retried: 0,
        },
        "notification projector activated",
      );
      return result;
    }

    const activity = await projectSource(
      adapter,
      vault,
      "activity",
      state,
      pageSize,
      signal,
    );
    state = activity.state;
    const comment = await projectSource(
      adapter,
      vault,
      "comment",
      state,
      pageSize,
      signal,
    );
    const result = {
      activated: false,
      activity: activity.result,
      comment: comment.result,
    };
    for (const [source, sourceResult] of Object.entries({
      activity: activity.result,
      comment: comment.result,
    })) {
      observe(
        span,
        {
          source,
          duration_ms: Date.now() - startedAt,
          scanned: sourceResult.scanned,
          malformed: sourceResult.malformed,
          delivered: sourceResult.delivered,
          skipped: sourceResult.skipped,
          retried: sourceResult.retried,
        },
        "notification projector source completed",
      );
    }
    return result;
  });
}
