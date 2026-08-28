import { ZodError, type z } from "zod";
import {
  ConflictError,
  NotFoundError,
  SchemaValidationError,
} from "../../../errors";
import {
  type EffectiveSubscriptionState,
  type Notification,
  type NotificationCreateInput,
  NotificationCreateInputSchema,
  type NotificationListInput,
  NotificationListInputSchema,
  NotificationRowSchema,
  type NotificationStateUpdateInput,
  NotificationStateUpdateInputSchema,
  type Subscription,
  type SubscriptionIdentity,
  SubscriptionIdentitySchema,
  type SubscriptionListInput,
  SubscriptionListInputSchema,
  SubscriptionRowSchema,
  type SubscriptionUpsertInput,
  SubscriptionUpsertInputSchema,
  buildNotificationKey,
  buildSubscriptionKey,
  effectiveSubscriptionState,
} from "../../../schemas/notifications";
import {
  type AkbAdapter,
  REEF_NOTIFICATIONS_TABLE,
  REEF_SUBSCRIPTIONS_TABLE,
  SqlParameterBuilder,
  decodeSettingsValue,
  runSql,
  tableRef,
  withSpan,
} from "../core/shared";

function validationError(error: ZodError): SchemaValidationError {
  return new SchemaValidationError({
    clientValidated: true,
    issues: error.issues.map(
      (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
    ),
  });
}

function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): z.output<S> {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) throw validationError(error);
    throw error;
  }
}

function notificationFromRow(row: Record<string, unknown>): Notification {
  return parseInput(NotificationRowSchema, {
    ...row,
    payload: decodeSettingsValue(row.payload),
    meta: decodeSettingsValue(row.meta),
  });
}

function subscriptionFromRow(row: Record<string, unknown>): Subscription {
  return parseInput(SubscriptionRowSchema, {
    ...row,
    meta: decodeSettingsValue(row.meta),
  });
}

function firstRow(
  response: Awaited<ReturnType<typeof runSql>>,
): Record<string, unknown> | undefined {
  return response.kind === "table_query" ? response.items[0] : undefined;
}

export async function createNotification(
  adapter: AkbAdapter,
  vault: string,
  input: NotificationCreateInput,
): Promise<Notification> {
  const parsed = parseInput(NotificationCreateInputSchema, input);
  const notificationKey =
    parsed.notificationKey ??
    buildNotificationKey({
      recipient: parsed.recipient,
      sourceType: parsed.sourceType,
      sourceRef: parsed.sourceRef,
    });
  return withSpan(
    "akb.notifications.create",
    { vault, source_type: parsed.sourceType },
    async () => {
      const params = new SqlParameterBuilder();
      const fields: Array<[string, string]> = [
        ["notification_key", params.add(notificationKey, "notification key")],
        ["recipient", params.add(parsed.recipient, "notification recipient")],
        ["reef_id", params.add(parsed.reefId, "notification reef id")],
        [
          "source_type",
          params.add(parsed.sourceType, "notification source type"),
        ],
        ["source_ref", params.add(parsed.sourceRef, "notification source ref")],
        ["event_type", params.add(parsed.eventType, "notification event type")],
        ["actor", params.add(parsed.actor, "notification actor")],
        [
          "occurred_at",
          params.add(parsed.occurredAt, "notification occurred at"),
        ],
        ["state", "'unread'"],
        ["read_at", "NULL"],
        ["archived_at", "NULL"],
        [
          "payload",
          parsed.payload == null
            ? "NULL"
            : params.addJson(parsed.payload, "notification payload", "jsonb"),
        ],
        [
          "meta",
          parsed.meta == null
            ? "NULL"
            : params.addJson(parsed.meta, "notification meta", "jsonb"),
        ],
      ];
      const columns = fields.map(([name]) => name).join(", ");
      const values = fields.map(([, value]) => value).join(", ");
      const response = await runSql(
        adapter,
        vault,
        `WITH upserted AS (INSERT INTO ${tableRef(
          REEF_NOTIFICATIONS_TABLE,
        )} (${columns}) VALUES (${values}) ON CONFLICT (notification_key) DO UPDATE SET notification_key = EXCLUDED.notification_key RETURNING *) SELECT * FROM upserted`,
        params.params,
      );
      const row = firstRow(response);
      if (!row) {
        throw new ConflictError({ path: `notification:${notificationKey}` });
      }
      const notification = notificationFromRow(row);
      if (
        notification.notification_key !== notificationKey ||
        notification.recipient !== parsed.recipient ||
        notification.source_type !== parsed.sourceType ||
        notification.source_ref !== parsed.sourceRef
      ) {
        throw new ConflictError({ path: `notification:${notificationKey}` });
      }
      return notification;
    },
  );
}

export async function listNotifications(
  adapter: AkbAdapter,
  vault: string,
  input: NotificationListInput,
): Promise<Notification[]> {
  const parsed = parseInput(NotificationListInputSchema, input);
  return withSpan(
    "akb.notifications.list",
    { vault, state: parsed.state },
    async (span) => {
      const params = new SqlParameterBuilder();
      const recipient = params.add(parsed.recipient, "notification recipient");
      const stateClause = parsed.state
        ? ` AND state = ${params.add(parsed.state, "notification state")}`
        : "";
      const limit = params.add(parsed.limit, "notification list limit");
      const response = await runSql(
        adapter,
        vault,
        `SELECT * FROM ${tableRef(
          REEF_NOTIFICATIONS_TABLE,
        )} WHERE recipient = ${recipient}${stateClause} ORDER BY occurred_at DESC, id DESC LIMIT ${limit}`,
        params.params,
      );
      const rows = response.kind === "table_query" ? response.items : [];
      const notifications = rows
        .map(notificationFromRow)
        .sort((left, right) => {
          const timeOrder = right.occurred_at.localeCompare(left.occurred_at);
          return timeOrder !== 0 ? timeOrder : right.id.localeCompare(left.id);
        });
      span.setAttribute("notification_count", notifications.length);
      return notifications;
    },
  );
}

export async function updateNotificationState(
  adapter: AkbAdapter,
  vault: string,
  input: NotificationStateUpdateInput,
): Promise<Notification> {
  const parsed = parseInput(NotificationStateUpdateInputSchema, input);
  const changedAt = parsed.changedAt ?? new Date().toISOString();
  const params = new SqlParameterBuilder();
  const state = params.add(parsed.state, "notification state");
  const changedAtParam =
    parsed.state === "unread"
      ? undefined
      : params.add(changedAt, "notification changed at");
  const timestamps =
    parsed.state === "unread"
      ? "read_at = NULL, archived_at = NULL"
      : parsed.state === "read"
        ? `read_at = COALESCE(read_at, ${changedAtParam}), archived_at = NULL`
        : `read_at = COALESCE(read_at, ${changedAtParam}), archived_at = COALESCE(archived_at, ${changedAtParam})`;
  const notificationKey = params.add(
    parsed.notificationKey,
    "notification key",
  );
  const recipient = params.add(parsed.recipient, "notification recipient");
  return withSpan(
    "akb.notifications.update_state",
    { vault, state: parsed.state },
    async () => {
      const response = await runSql(
        adapter,
        vault,
        `WITH updated AS (UPDATE ${tableRef(
          REEF_NOTIFICATIONS_TABLE,
        )} SET state = ${state}, ${timestamps} WHERE notification_key = ${notificationKey} AND recipient = ${recipient} RETURNING *) SELECT * FROM updated`,
        params.params,
      );
      const row = firstRow(response);
      if (!row) throw new NotFoundError({ resource: "notification" });
      return notificationFromRow(row);
    },
  );
}

export async function upsertSubscription(
  adapter: AkbAdapter,
  vault: string,
  input: SubscriptionUpsertInput,
): Promise<Subscription> {
  const parsed = parseInput(SubscriptionUpsertInputSchema, input);
  const subscriptionKey =
    parsed.subscriptionKey ??
    buildSubscriptionKey({
      reefId: parsed.reefId,
      subscriber: parsed.subscriber,
      source: parsed.source,
    });
  const subscribedAt = parsed.subscribedAt ?? new Date().toISOString();
  return withSpan(
    "akb.subscriptions.upsert",
    { vault, source: parsed.source, status: parsed.status },
    async () => {
      const params = new SqlParameterBuilder();
      const subscriptionKeyParam = params.add(
        subscriptionKey,
        "subscription key",
      );
      const reefIdParam = params.add(parsed.reefId, "subscription reef id");
      const subscriberParam = params.add(
        parsed.subscriber,
        "subscription subscriber",
      );
      const sourceParam = params.add(parsed.source, "subscription source");
      const statusParam = params.add(parsed.status, "subscription status");
      const subscribedAtParam = params.add(
        subscribedAt,
        "subscription subscribed at",
      );
      const metaParam =
        parsed.meta == null
          ? "NULL"
          : params.addJson(parsed.meta, "subscription meta", "jsonb");
      const response = await runSql(
        adapter,
        vault,
        `WITH upserted AS (INSERT INTO ${tableRef(
          REEF_SUBSCRIPTIONS_TABLE,
        )} (subscription_key, reef_id, subscriber, source, status, subscribed_at, meta) VALUES (${subscriptionKeyParam}, ${reefIdParam}, ${subscriberParam}, ${sourceParam}, ${statusParam}, ${subscribedAtParam}, ${metaParam}) ON CONFLICT (subscription_key) DO UPDATE SET status = EXCLUDED.status RETURNING *) SELECT * FROM upserted`,
        params.params,
      );
      const row = firstRow(response);
      if (!row) {
        throw new ConflictError({ path: `subscription:${subscriptionKey}` });
      }
      const subscription = subscriptionFromRow(row);
      if (
        subscription.subscription_key !== subscriptionKey ||
        subscription.reef_id !== parsed.reefId ||
        subscription.subscriber !== parsed.subscriber ||
        subscription.source !== parsed.source
      ) {
        throw new ConflictError({ path: `subscription:${subscriptionKey}` });
      }
      return subscription;
    },
  );
}

export async function removeSubscription(
  adapter: AkbAdapter,
  vault: string,
  identity: SubscriptionIdentity,
): Promise<boolean> {
  const parsed = parseInput(SubscriptionIdentitySchema, identity);
  return withSpan(
    "akb.subscriptions.remove",
    { vault, source: parsed.source },
    async (span) => {
      const params = new SqlParameterBuilder();
      const reefId = params.add(parsed.reefId, "subscription reef id");
      const subscriber = params.add(
        parsed.subscriber,
        "subscription subscriber",
      );
      const source = params.add(parsed.source, "subscription source");
      const response = await runSql(
        adapter,
        vault,
        `WITH removed AS (DELETE FROM ${tableRef(
          REEF_SUBSCRIPTIONS_TABLE,
        )} WHERE reef_id = ${reefId} AND subscriber = ${subscriber} AND source = ${source} RETURNING id) SELECT id FROM removed`,
        params.params,
      );
      const removed =
        response.kind === "table_query" && response.items.length > 0;
      span.setAttribute("removed", removed);
      return removed;
    },
  );
}

export async function listSubscriptions(
  adapter: AkbAdapter,
  vault: string,
  input: SubscriptionListInput,
): Promise<Subscription[]> {
  const parsed = parseInput(SubscriptionListInputSchema, input);
  return withSpan(
    "akb.subscriptions.list",
    { vault, status: parsed.status },
    async (span) => {
      const params = new SqlParameterBuilder();
      const reefId = params.add(parsed.reefId, "subscription reef id");
      const subscriberClause = parsed.subscriber
        ? ` AND subscriber = ${params.add(
            parsed.subscriber,
            "subscription subscriber",
          )}`
        : "";
      const statusClause = parsed.status
        ? ` AND status = ${params.add(parsed.status, "subscription status")}`
        : "";
      const response = await runSql(
        adapter,
        vault,
        `SELECT * FROM ${tableRef(
          REEF_SUBSCRIPTIONS_TABLE,
        )} WHERE reef_id = ${reefId}${subscriberClause}${statusClause} ORDER BY subscriber ASC, source ASC, id ASC`,
        params.params,
      );
      const rows = response.kind === "table_query" ? response.items : [];
      const subscriptions = rows.map(subscriptionFromRow);
      span.setAttribute("subscription_count", subscriptions.length);
      return subscriptions;
    },
  );
}

export interface ManualSubscriptionInput {
  reefId: string;
  subscriber: string;
  subscribedAt?: string;
  meta?: Record<string, unknown> | null;
}

export function watchIssue(
  adapter: AkbAdapter,
  vault: string,
  input: ManualSubscriptionInput,
): Promise<Subscription> {
  return upsertSubscription(adapter, vault, {
    ...input,
    source: "manual",
    status: "active",
  });
}

export function muteIssue(
  adapter: AkbAdapter,
  vault: string,
  input: ManualSubscriptionInput,
): Promise<Subscription> {
  return upsertSubscription(adapter, vault, {
    ...input,
    source: "manual",
    status: "muted",
  });
}

export async function getEffectiveSubscriptionState(
  adapter: AkbAdapter,
  vault: string,
  input: Pick<SubscriptionIdentity, "reefId" | "subscriber">,
): Promise<EffectiveSubscriptionState> {
  const subscriptions = await listSubscriptions(adapter, vault, input);
  return effectiveSubscriptionState(subscriptions);
}
