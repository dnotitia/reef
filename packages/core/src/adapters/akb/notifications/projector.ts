import { z } from "zod";
import { ConflictError, SchemaValidationError } from "../../../errors";
import {
  type NotificationCreateInput,
  buildNotificationKey,
} from "../../../schemas/notifications";
import {
  type AkbAdapter,
  REEF_ACTIVITY_TABLE,
  REEF_COMMENTS_TABLE,
  REEF_SETTINGS_NOTIFICATION_PROJECTOR_KEY,
  REEF_SETTINGS_TABLE,
  REEF_SUBSCRIPTIONS_TABLE,
  decodeSettingsValue,
  quoteJson,
  quoteText,
  runSql,
  tableRef,
  withSpan,
} from "../core/shared";
import { createNotification } from "./notifications";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

const CursorSchema = z
  .object({
    occurred_at: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();

const ProjectorCheckpointSchema = z
  .object({
    activated_at: z.string().datetime({ offset: true }),
    activity_cursor: CursorSchema.nullable(),
    comment_cursor: CursorSchema.nullable(),
  })
  .strict();

const RawActivitySourceSchema = z
  .object({
    id: z.string().min(1),
    reef_id: z.string().min(1),
    event_type: z.string().min(1),
    event_key: z.string().min(1),
    meta: z
      .object({
        actor: z.string().min(1),
        at: z.string().datetime({ offset: true }),
      })
      .passthrough(),
  })
  .strict();

const RawCommentSourceSchema = z
  .object({
    id: z.string().min(1),
    reef_id: z.string().min(1),
    meta: z
      .object({
        author: z.string().min(1),
        created_at: z.string().datetime({ offset: true }),
      })
      .passthrough(),
  })
  .strict();

const RawSubscriptionSchema = z
  .object({
    subscriber: z.string().min(1),
    source: z.string().min(1),
    status: z.enum(["active", "muted"]),
  })
  .strict();

type Cursor = z.infer<typeof CursorSchema>;
type ProjectorCheckpoint = z.infer<typeof ProjectorCheckpointSchema>;

type ProjectableSource = {
  reefId: string;
  sourceType: "activity" | "comment";
  sourceRef: string;
  eventType: string;
  actor: string;
  occurredAt: string;
};

export interface NotificationProjectorInput {
  adapter: AkbAdapter;
  vault: string;
  batchSize?: number;
  now?: () => Date;
}

export interface NotificationProjectionSourceResult {
  scanned: number;
  fannedOut: number;
  skippedMalformed: number;
  skippedNoRecipients: number;
  cursor: Cursor | null;
  failed: boolean;
}

export interface NotificationProjectionResult {
  activatedAt: string;
  activated: boolean;
  activity: NotificationProjectionSourceResult;
  comment: NotificationProjectionSourceResult;
}

function schemaError(message: string): SchemaValidationError {
  return new SchemaValidationError({
    clientValidated: true,
    issues: [message],
  });
}

function validateBatchSize(value: number | undefined): number {
  if (value == null) return DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_BATCH_SIZE) {
    throw schemaError(
      `batchSize must be an integer from 1 to ${MAX_BATCH_SIZE}`,
    );
  }
  return value;
}

function rows(
  response: Awaited<ReturnType<typeof runSql>>,
): Record<string, unknown>[] {
  return response.kind === "table_query" ? response.items : [];
}

function parseCheckpoint(value: unknown): ProjectorCheckpoint {
  const parsed = ProjectorCheckpointSchema.safeParse(
    decodeSettingsValue(value),
  );
  if (!parsed.success) {
    throw schemaError("notification projector checkpoint is invalid");
  }
  return parsed.data;
}

async function loadOrActivateCheckpoint(
  adapter: AkbAdapter,
  vault: string,
  activatedAt: string,
): Promise<{ checkpoint: ProjectorCheckpoint; activated: boolean }> {
  const existing = await runSql(
    adapter,
    vault,
    `SELECT value FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${quoteText(
      REEF_SETTINGS_NOTIFICATION_PROJECTOR_KEY,
      "notification projector settings key",
    )} LIMIT 1`,
  );
  const value = rows(existing)[0]?.value;
  if (value !== undefined) {
    return { checkpoint: parseCheckpoint(value), activated: false };
  }

  const initial: ProjectorCheckpoint = {
    activated_at: activatedAt,
    activity_cursor: null,
    comment_cursor: null,
  };
  const created = await runSql(
    adapter,
    vault,
    `WITH inserted AS (INSERT INTO ${tableRef(
      REEF_SETTINGS_TABLE,
    )} (key, value) SELECT ${quoteText(
      REEF_SETTINGS_NOTIFICATION_PROJECTOR_KEY,
      "notification projector settings key",
    )}, ${quoteJson(initial)} WHERE NOT EXISTS (SELECT 1 FROM ${tableRef(
      REEF_SETTINGS_TABLE,
    )} WHERE key = ${quoteText(
      REEF_SETTINGS_NOTIFICATION_PROJECTOR_KEY,
      "notification projector settings key",
    )}) RETURNING value) SELECT value FROM inserted UNION ALL SELECT value FROM ${tableRef(
      REEF_SETTINGS_TABLE,
    )} WHERE key = ${quoteText(
      REEF_SETTINGS_NOTIFICATION_PROJECTOR_KEY,
      "notification projector settings key",
    )} LIMIT 1`,
  );
  return {
    checkpoint: parseCheckpoint(rows(created)[0]?.value),
    activated: true,
  };
}

async function persistCheckpoint(
  adapter: AkbAdapter,
  vault: string,
  checkpoint: ProjectorCheckpoint,
): Promise<void> {
  const response = await runSql(
    adapter,
    vault,
    `WITH updated AS (UPDATE ${tableRef(
      REEF_SETTINGS_TABLE,
    )} SET value = ${quoteJson(checkpoint)} WHERE key = ${quoteText(
      REEF_SETTINGS_NOTIFICATION_PROJECTOR_KEY,
      "notification projector settings key",
    )} RETURNING value) SELECT value FROM updated`,
  );
  if (rows(response).length === 0) {
    throw new ConflictError({ path: "notification-projector-checkpoint" });
  }
}

function cursorFromRaw(
  row: Record<string, unknown>,
  timeField: "at" | "created_at",
): Cursor | null {
  const meta = decodeSettingsValue(row.meta);
  if (
    typeof row.id !== "string" ||
    !meta ||
    typeof meta !== "object" ||
    typeof (meta as Record<string, unknown>)[timeField] !== "string"
  ) {
    return null;
  }
  return {
    id: row.id,
    occurred_at: (meta as Record<string, string>)[timeField],
  };
}

async function readSourceRows(
  adapter: AkbAdapter,
  vault: string,
  source: "activity" | "comment",
  activatedAt: string,
  cursor: Cursor | null,
  batchSize: number,
): Promise<Record<string, unknown>[]> {
  const table =
    source === "activity" ? REEF_ACTIVITY_TABLE : REEF_COMMENTS_TABLE;
  const timeField = source === "activity" ? "at" : "created_at";
  const columns =
    source === "activity"
      ? "id, reef_id, event_type, event_key, meta"
      : "id, reef_id, meta";
  const cursorClause = cursor
    ? ` AND ((meta->>'${timeField}') > ${quoteText(
        cursor.occurred_at,
        "notification projector cursor time",
      )} OR ((meta->>'${timeField}') = ${quoteText(
        cursor.occurred_at,
        "notification projector cursor time",
      )} AND id::text > ${quoteText(
        cursor.id,
        "notification projector cursor id",
      )}))`
    : "";
  const response = await runSql(
    adapter,
    vault,
    `SELECT ${columns} FROM ${tableRef(table)} WHERE meta->>'${timeField}' > ${quoteText(
      activatedAt,
      "notification projector activation time",
    )}${cursorClause} ORDER BY meta->>'${timeField}' ASC, id ASC LIMIT ${batchSize}`,
  );
  return rows(response);
}

function mapSource(
  source: "activity" | "comment",
  row: Record<string, unknown>,
): ProjectableSource | null {
  if (source === "activity") {
    const parsed = RawActivitySourceSchema.safeParse({
      ...row,
      meta: decodeSettingsValue(row.meta),
    });
    if (!parsed.success) return null;
    return {
      reefId: parsed.data.reef_id,
      sourceType: "activity",
      sourceRef: parsed.data.event_key,
      eventType: parsed.data.event_type,
      actor: parsed.data.meta.actor,
      occurredAt: parsed.data.meta.at,
    };
  }
  const parsed = RawCommentSourceSchema.safeParse({
    ...row,
    meta: decodeSettingsValue(row.meta),
  });
  if (!parsed.success) return null;
  return {
    reefId: parsed.data.reef_id,
    sourceType: "comment",
    sourceRef: parsed.data.id,
    eventType: "comment_created",
    actor: parsed.data.meta.author,
    occurredAt: parsed.data.meta.created_at,
  };
}

async function recipientsForSource(
  adapter: AkbAdapter,
  vault: string,
  source: ProjectableSource,
): Promise<string[]> {
  const response = await runSql(
    adapter,
    vault,
    `SELECT subscriber, source, status FROM ${tableRef(
      REEF_SUBSCRIPTIONS_TABLE,
    )} WHERE reef_id = ${quoteText(source.reefId, "notification reef id")} ORDER BY subscriber ASC, source ASC, id ASC`,
  );
  const subscriptions = rows(response)
    .map((row) => RawSubscriptionSchema.safeParse(row))
    .filter(
      (
        parsed,
      ): parsed is z.SafeParseSuccess<z.infer<typeof RawSubscriptionSchema>> =>
        parsed.success,
    )
    .map((parsed) => parsed.data);
  const bySubscriber = new Map<
    string,
    z.infer<typeof RawSubscriptionSchema>[]
  >();
  for (const subscription of subscriptions) {
    const entries = bySubscriber.get(subscription.subscriber) ?? [];
    entries.push(subscription);
    bySubscriber.set(subscription.subscriber, entries);
  }
  return [...bySubscriber]
    .filter(([subscriber, entries]) => {
      if (subscriber === source.actor) return false;
      if (
        entries.some(
          (entry) => entry.source === "manual" && entry.status === "muted",
        )
      ) {
        return false;
      }
      return entries.some((entry) => entry.status === "active");
    })
    .map(([subscriber]) => subscriber)
    .sort((left, right) => left.localeCompare(right));
}

async function fanOutSource(
  adapter: AkbAdapter,
  vault: string,
  source: ProjectableSource,
): Promise<number> {
  const recipients = await recipientsForSource(adapter, vault, source);
  for (const recipient of recipients) {
    const identity = {
      recipient,
      sourceType: source.sourceType,
      sourceRef: source.sourceRef,
    };
    const notification: NotificationCreateInput = {
      ...identity,
      notificationKey: buildNotificationKey(identity),
      reefId: source.reefId,
      eventType: source.eventType,
      actor: source.actor,
      occurredAt: source.occurredAt,
      payload: {
        source_type: source.sourceType,
        source_ref: source.sourceRef,
      },
    };
    await createNotification(adapter, vault, notification);
  }
  return recipients.length;
}

async function projectSource(
  adapter: AkbAdapter,
  vault: string,
  source: "activity" | "comment",
  checkpoint: ProjectorCheckpoint,
  batchSize: number,
): Promise<NotificationProjectionSourceResult> {
  const cursorField =
    source === "activity" ? "activity_cursor" : "comment_cursor";
  const timeField = source === "activity" ? "at" : "created_at";
  const result: NotificationProjectionSourceResult = {
    scanned: 0,
    fannedOut: 0,
    skippedMalformed: 0,
    skippedNoRecipients: 0,
    cursor: checkpoint[cursorField],
    failed: false,
  };
  while (true) {
    let sourceRows: Record<string, unknown>[];
    try {
      sourceRows = await readSourceRows(
        adapter,
        vault,
        source,
        checkpoint.activated_at,
        checkpoint[cursorField],
        batchSize,
      );
    } catch {
      result.failed = true;
      return result;
    }
    if (sourceRows.length === 0) return result;
    for (const row of sourceRows) {
      const cursor = cursorFromRaw(row, timeField);
      if (!cursor) {
        result.skippedMalformed += 1;
        continue;
      }
      result.scanned += 1;
      const mapped = mapSource(source, row);
      if (!mapped) {
        result.skippedMalformed += 1;
      } else {
        try {
          const fannedOut = await fanOutSource(adapter, vault, mapped);
          result.fannedOut += fannedOut;
          if (fannedOut === 0) result.skippedNoRecipients += 1;
        } catch {
          result.failed = true;
          return result;
        }
      }
      checkpoint[cursorField] = cursor;
      try {
        await persistCheckpoint(adapter, vault, checkpoint);
      } catch {
        result.failed = true;
        return result;
      }
      result.cursor = cursor;
    }
    if (sourceRows.length < batchSize) return result;
  }
}

export async function projectNotifications(
  input: NotificationProjectorInput,
): Promise<NotificationProjectionResult> {
  const batchSize = validateBatchSize(input.batchSize);
  const activatedAt = (input.now ?? (() => new Date()))().toISOString();
  return withSpan(
    "akb.notifications.project",
    { vault: input.vault },
    async (span) => {
      const { checkpoint, activated } = await loadOrActivateCheckpoint(
        input.adapter,
        input.vault,
        activatedAt,
      );
      const activity = await projectSource(
        input.adapter,
        input.vault,
        "activity",
        checkpoint,
        batchSize,
      );
      const comment = await projectSource(
        input.adapter,
        input.vault,
        "comment",
        checkpoint,
        batchSize,
      );
      span.setAttribute("activated", activated);
      span.setAttribute("activity_scanned", activity.scanned);
      span.setAttribute("comment_scanned", comment.scanned);
      span.setAttribute("activity_failed", activity.failed);
      span.setAttribute("comment_failed", comment.failed);
      return {
        activatedAt: checkpoint.activated_at,
        activated,
        activity,
        comment,
      };
    },
  );
}
