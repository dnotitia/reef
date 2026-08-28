import { z } from "zod";
import { ConflictError, SchemaValidationError } from "../../../errors";
import {
  ACTIVITY_EVENT_ISSUE_BODY_MENTIONS_CHANGE,
  IssueBodyMentionsChangePayloadSchema,
} from "../../../schemas/issues/activity";
import {
  type NotificationCreateInput,
  buildNotificationKey,
} from "../../../schemas/notifications";
import { parsePersistedMentionRecipients } from "../../../schemas/issues/mention";
import {
  type AkbAdapter,
  REEF_ACTIVITY_TABLE,
  REEF_COMMENTS_TABLE,
  REEF_SETTINGS_NOTIFICATION_PROJECTOR_KEY,
  REEF_SETTINGS_TABLE,
  REEF_SUBSCRIPTIONS_TABLE,
  SqlParameterBuilder,
  decodeSettingsValue,
  runSql,
  tableRef,
  withSpan,
} from "../core/shared";
import { createNotification } from "./notifications";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const IsoDateTimeSchema = z.iso.datetime({ offset: true });

const CursorSchema = z.strictObject({
  occurred_at: z.string().min(1),
  id: z.string().min(1),
});

const ProjectorCheckpointSchema = z.strictObject({
  activated_at: z.iso.datetime({ offset: true }),
  activity_cursor: CursorSchema.nullable(),
  comment_cursor: CursorSchema.nullable(),
});

const RawActivitySourceSchema = z.strictObject({
  id: z.string().min(1),
  reef_id: z.string().min(1),
  event_type: z.string().min(1),
  event_key: z.string().min(1),
  payload: z.unknown().nullable().optional(),
  meta: z.looseObject({
    actor: z.string().min(1),
    at: z.iso.datetime({ offset: true }),
  }),
});

const RawCommentSourceSchema = z.strictObject({
  id: z.string().min(1),
  reef_id: z.string().min(1),
  meta: z.looseObject({
    author: z.string().min(1),
    created_at: z.iso.datetime({ offset: true }),
    edited_at: z.unknown().optional(),
    mention_recipients: z.unknown().optional(),
  }),
});

const RawSubscriptionSchema = z.strictObject({
  subscriber: z.string().min(1),
  source: z.string().min(1),
  status: z.enum(["active", "muted"]),
});

type Cursor = z.infer<typeof CursorSchema>;
type ProjectorCheckpoint = z.infer<typeof ProjectorCheckpointSchema>;

type ProjectableSource = {
  reefId: string;
  sourceType: "activity" | "comment";
  sourceRef: string;
  eventType: string;
  actor: string;
  occurredAt: string;
  mentionRecipients: string[];
  directMentionOnly: boolean;
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
  const lookupParams = new SqlParameterBuilder();
  const settingsKey = lookupParams.add(
    REEF_SETTINGS_NOTIFICATION_PROJECTOR_KEY,
    "notification projector settings key",
  );
  const existing = await runSql(
    adapter,
    vault,
    `SELECT value FROM ${tableRef(
      REEF_SETTINGS_TABLE,
    )} WHERE key = ${settingsKey} LIMIT 1`,
    lookupParams.params,
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
  const createParams = new SqlParameterBuilder();
  const createKey = createParams.add(
    REEF_SETTINGS_NOTIFICATION_PROJECTOR_KEY,
    "notification projector settings key",
  );
  const checkpointValue = createParams.addJson(
    initial,
    "notification projector checkpoint",
  );
  const created = await runSql(
    adapter,
    vault,
    `WITH inserted AS (INSERT INTO ${tableRef(
      REEF_SETTINGS_TABLE,
    )} (key, value) SELECT ${createKey}, ${checkpointValue} WHERE NOT EXISTS (SELECT 1 FROM ${tableRef(
      REEF_SETTINGS_TABLE,
    )} WHERE key = ${createKey}) RETURNING value) SELECT value FROM inserted UNION ALL SELECT value FROM ${tableRef(
      REEF_SETTINGS_TABLE,
    )} WHERE key = ${createKey} LIMIT 1`,
    createParams.params,
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
  const params = new SqlParameterBuilder();
  const checkpointValue = params.addJson(
    checkpoint,
    "notification projector checkpoint",
  );
  const settingsKey = params.add(
    REEF_SETTINGS_NOTIFICATION_PROJECTOR_KEY,
    "notification projector settings key",
  );
  const response = await runSql(
    adapter,
    vault,
    `WITH updated AS (UPDATE ${tableRef(
      REEF_SETTINGS_TABLE,
    )} SET value = ${checkpointValue} WHERE key = ${settingsKey} RETURNING value) SELECT value FROM updated`,
    params.params,
  );
  if (rows(response).length === 0) {
    throw new ConflictError({ path: "notification-projector-checkpoint" });
  }
}

function cursorFromRaw(
  row: Record<string, unknown>,
  source: "activity" | "comment",
): Cursor | null {
  if (source === "activity") {
    const meta = decodeSettingsValue(row.meta);
    if (
      typeof row.id !== "string" ||
      !meta ||
      typeof meta !== "object" ||
      typeof (meta as Record<string, unknown>).at !== "string"
    ) {
      return null;
    }
    return {
      id: row.id,
      occurred_at: (meta as Record<string, string>).at,
    };
  }

  const parsed = RawCommentSourceSchema.safeParse({
    ...row,
    meta: decodeSettingsValue(row.meta),
  });
  if (!parsed.success) return null;
  const editedAt = IsoDateTimeSchema.safeParse(parsed.data.meta.edited_at);
  return {
    id: parsed.data.id,
    occurred_at: editedAt.success ? editedAt.data : parsed.data.meta.created_at,
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
  const timeExpression =
    source === "activity"
      ? "meta->>'at'"
      : "COALESCE(meta->>'edited_at', meta->>'created_at')";
  const columns =
    source === "activity"
      ? "id, reef_id, event_type, event_key, payload, meta"
      : "id, reef_id, meta";
  const params = new SqlParameterBuilder();
  const activationParam = params.add(
    activatedAt,
    "notification projector activation time",
  );
  let cursorClause = "";
  if (cursor) {
    const cursorTimeParam = params.add(
      cursor.occurred_at,
      "notification projector cursor time",
    );
    const cursorIdParam = params.add(
      cursor.id,
      "notification projector cursor id",
    );
    cursorClause = ` AND ((${timeExpression}) > ${cursorTimeParam} OR ((${timeExpression}) = ${cursorTimeParam} AND id::text > ${cursorIdParam}))`;
  }
  const batchSizeParam = params.add(
    batchSize,
    "notification projector batch size",
  );
  const response = await runSql(
    adapter,
    vault,
    `SELECT ${columns} FROM ${tableRef(
      table,
    )} WHERE (${timeExpression}) > ${activationParam}${cursorClause} ORDER BY (${timeExpression}) ASC, id ASC LIMIT ${batchSizeParam}`,
    params.params,
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
      payload: decodeSettingsValue(row.payload),
    });
    if (!parsed.success) return null;
    if (parsed.data.event_type === ACTIVITY_EVENT_ISSUE_BODY_MENTIONS_CHANGE) {
      const payload = IssueBodyMentionsChangePayloadSchema.safeParse(
        parsed.data.payload,
      );
      if (!payload.success) return null;
      const mentionRecipients = parsePersistedMentionRecipients(
        payload.data.added,
      );
      if (payload.data.added.length > 0 && mentionRecipients.length === 0) {
        return null;
      }
      return {
        reefId: parsed.data.reef_id,
        sourceType: "activity",
        sourceRef: parsed.data.event_key,
        eventType: parsed.data.event_type,
        actor: parsed.data.meta.actor,
        occurredAt: parsed.data.meta.at,
        mentionRecipients,
        directMentionOnly: true,
      };
    }
    return {
      reefId: parsed.data.reef_id,
      sourceType: "activity",
      sourceRef: parsed.data.event_key,
      eventType: parsed.data.event_type,
      actor: parsed.data.meta.actor,
      occurredAt: parsed.data.meta.at,
      mentionRecipients: [],
      directMentionOnly: false,
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
    occurredAt: (() => {
      const editedAt = IsoDateTimeSchema.safeParse(parsed.data.meta.edited_at);
      return editedAt.success ? editedAt.data : parsed.data.meta.created_at;
    })(),
    mentionRecipients: parsePersistedMentionRecipients(
      parsed.data.meta.mention_recipients,
    ),
    directMentionOnly: false,
  };
}

async function recipientsForSource(
  adapter: AkbAdapter,
  vault: string,
  source: ProjectableSource,
): Promise<string[]> {
  const params = new SqlParameterBuilder();
  const reefIdParam = params.add(source.reefId, "notification reef id");
  const response = await runSql(
    adapter,
    vault,
    `SELECT subscriber, source, status FROM ${tableRef(
      REEF_SUBSCRIPTIONS_TABLE,
    )} WHERE reef_id = ${reefIdParam} ORDER BY subscriber ASC, source ASC, id ASC`,
    params.params,
  );
  const subscriptions = rows(response)
    .map((row) => RawSubscriptionSchema.safeParse(row))
    .filter(
      (
        parsed,
      ): parsed is z.ZodSafeParseSuccess<
        z.infer<typeof RawSubscriptionSchema>
      > => parsed.success,
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
  const mentioned = new Set(source.mentionRecipients);
  const candidates = source.directMentionOnly
    ? mentioned
    : new Set([...bySubscriber.keys(), ...mentioned]);
  return [...candidates]
    .filter((subscriber) => {
      const entries = bySubscriber.get(subscriber) ?? [];
      if (subscriber === source.actor) return false;
      if (
        entries.some(
          (entry) => entry.source === "manual" && entry.status === "muted",
        )
      ) {
        return false;
      }
      return source.directMentionOnly
        ? mentioned.has(subscriber)
        : mentioned.has(subscriber) ||
            entries.some((entry) => entry.status === "active");
    })
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
      const cursor = cursorFromRaw(row, source);
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
