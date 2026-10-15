import { ZodError, type z } from "zod";
import {
  ConflictError,
  NotFoundError,
  SchemaValidationError,
} from "../../../errors";
import {
  ACTIVITY_EVENT_STATUS_CHANGE,
  ActivityEventMetaSchema,
  ActivityEventSchema,
} from "../../../schemas/issues/activity";
import { IssueMetadataSchema } from "../../../schemas/issues/metadata";
import {
  type EffectiveSubscriptionState,
  type Notification,
  type NotificationCreateInput,
  NotificationCreateInputSchema,
  NotificationRowSchema,
  type PersonalNotification,
  type PersonalNotificationListInput,
  PersonalNotificationListInputSchema,
  type PersonalNotificationReadAllInput,
  type PersonalNotificationReadAllResult,
  type PersonalNotificationTarget,
  PersonalNotificationReadAllInputSchema,
  PersonalNotificationReadAllResultSchema,
  PersonalNotificationTargetSchema,
  PersonalNotificationSchema,
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
  REEF_ACTIVITY_TABLE,
  REEF_ISSUES_TABLE,
  REEF_SUBSCRIPTIONS_TABLE,
  SqlParameterBuilder,
  canonicalTableSelectColumns,
  crossVaultTableRef,
  decodeSettingsValue,
  runSql,
  tableRef,
  withSpan,
} from "../core/shared";
import { StatusChangePayloadSchema } from "../../../schemas/issues/activity";
import { VaultNameSchema } from "../../../schemas/workspace/config";

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

type PersonalNotificationBase = Notification & {
  workspace: PersonalNotification["workspace"];
};

type PersonalNotificationStatusChangeContext = Exclude<
  PersonalNotification["status_change_context"],
  null
>;

const PersonalNotificationIssueTitleSchema = IssueMetadataSchema.pick({
  id: true,
  title: true,
});

function personalNotificationBaseFromRow(
  row: Record<string, unknown>,
): PersonalNotificationBase {
  return {
    ...notificationFromRow(row),
    workspace: parseInput(VaultNameSchema, row.workspace),
  };
}

function activityReferenceKey(reefId: string, eventKey: string): string {
  return JSON.stringify([reefId, eventKey]);
}

function validatedPersonalWorkspaces(workspaces: string[]): string[] {
  const sorted = [...new Set(workspaces)].sort();
  if (sorted.length !== workspaces.length) {
    throw new SchemaValidationError({
      issues: ["notification workspaces must be unique"],
    });
  }
  const aliases = new Set<string>();
  for (const workspace of sorted) {
    const alias = workspace.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (aliases.has(alias)) {
      throw new SchemaValidationError({
        issues: [
          "notification workspaces collide in the cross-vault SQL alias",
        ],
      });
    }
    aliases.add(alias);
  }
  return sorted;
}

async function readNotificationIssueTitles(
  adapter: AkbAdapter,
  workspace: string,
  notifications: PersonalNotificationBase[],
): Promise<Map<string, PersonalNotification["issue_context"]>> {
  const issueIds = [...new Set(notifications.map(({ reef_id }) => reef_id))];
  const params = new SqlParameterBuilder();
  const issueIdParameters = issueIds.map((reefId) =>
    params.add(reefId, "notification source issue id"),
  );

  return withSpan(
    "akb.notifications.read_personal_issue_titles",
    { vault: workspace, issue_count: issueIds.length },
    async (span) => {
      try {
        const response = await runSql(
          adapter,
          workspace,
          `SELECT reef_id, title FROM ${tableRef(
            REEF_ISSUES_TABLE,
          )} WHERE reef_id IN (${issueIdParameters.join(", ")})`,
          params.params,
        );
        const issueContexts = new Map<
          string,
          PersonalNotification["issue_context"]
        >();
        if (response.kind !== "table_query") {
          span.setAttribute("issue_title_count", 0);
          return issueContexts;
        }

        for (const row of response.items) {
          const issue = PersonalNotificationIssueTitleSchema.safeParse({
            id: row.reef_id,
            title: row.title,
          });
          if (!issue.success || !issue.data.title.trim()) continue;
          issueContexts.set(issue.data.id, {
            availability: "available",
            title: issue.data.title,
          });
        }
        span.setAttribute("issue_title_count", issueContexts.size);
        return issueContexts;
      } catch {
        span.setAttribute("issue_title_count", 0);
        return new Map();
      }
    },
  );
}

async function readNotificationStatusChanges(
  adapter: AkbAdapter,
  workspace: string,
  notifications: PersonalNotificationBase[],
): Promise<Map<string, PersonalNotificationStatusChangeContext>> {
  const sources = new Map<string, { reefId: string; eventKey: string }>();
  for (const notification of notifications) {
    if (
      notification.event_type !== ACTIVITY_EVENT_STATUS_CHANGE ||
      notification.source_type !== "activity"
    ) {
      continue;
    }
    const key = activityReferenceKey(
      notification.reef_id,
      notification.source_ref,
    );
    sources.set(key, {
      reefId: notification.reef_id,
      eventKey: notification.source_ref,
    });
  }
  if (sources.size === 0) return new Map();

  const params = new SqlParameterBuilder();
  const sourcePairs = [...sources.values()].map(({ reefId, eventKey }) => {
    const reefIdParameter = params.add(
      reefId,
      "notification activity issue id",
    );
    const eventKeyParameter = params.add(
      eventKey,
      "notification activity event key",
    );
    return `(${reefIdParameter}, ${eventKeyParameter})`;
  });

  return withSpan(
    "akb.notifications.read_personal_status_changes",
    { vault: workspace, status_change_count: sources.size },
    async (span) => {
      try {
        const response = await runSql(
          adapter,
          workspace,
          `SELECT id, reef_id, event_type, event_key, payload, meta FROM ${tableRef(
            REEF_ACTIVITY_TABLE,
          )} WHERE (reef_id, event_key) IN (${sourcePairs.join(", ")}) AND event_type = '${ACTIVITY_EVENT_STATUS_CHANGE}'`,
          params.params,
        );
        const transitions = new Map<
          string,
          PersonalNotificationStatusChangeContext
        >();
        if (response.kind !== "table_query") {
          span.setAttribute("available_transition_count", 0);
          return transitions;
        }

        for (const row of response.items) {
          const meta = ActivityEventMetaSchema.safeParse(
            decodeSettingsValue(row.meta) ?? {},
          );
          if (!meta.success) continue;
          const payload = StatusChangePayloadSchema.safeParse(
            decodeSettingsValue(row.payload) ?? {},
          );
          if (!payload.success) continue;
          const event = ActivityEventSchema.safeParse({
            id: row.id,
            reef_id: row.reef_id,
            event_type: row.event_type,
            event_key: row.event_key,
            payload: payload.data,
            actor: meta.data.actor,
            at: meta.data.at,
            source: meta.data.source,
          });
          if (
            !event.success ||
            event.data.event_type !== ACTIVITY_EVENT_STATUS_CHANGE
          ) {
            continue;
          }
          transitions.set(
            activityReferenceKey(event.data.reef_id, event.data.event_key),
            {
              availability: "available",
              from: event.data.payload.from,
              to: event.data.payload.to,
            },
          );
        }
        span.setAttribute("available_transition_count", transitions.size);
        return transitions;
      } catch {
        span.setAttribute("available_transition_count", 0);
        return new Map();
      }
    },
  );
}

async function enrichPersonalNotifications(
  adapter: AkbAdapter,
  notifications: PersonalNotificationBase[],
): Promise<PersonalNotification[]> {
  const byWorkspace = new Map<string, PersonalNotificationBase[]>();
  for (const notification of notifications) {
    const group = byWorkspace.get(notification.workspace) ?? [];
    group.push(notification);
    byWorkspace.set(notification.workspace, group);
  }

  const contexts = await Promise.all(
    [...byWorkspace].map(async ([workspace, sourceNotifications]) => {
      const [issueTitles, statusChanges] = await Promise.all([
        readNotificationIssueTitles(adapter, workspace, sourceNotifications),
        readNotificationStatusChanges(adapter, workspace, sourceNotifications),
      ]);
      return [workspace, issueTitles, statusChanges] as const;
    }),
  );
  const contextByWorkspace = new Map(
    contexts.map(([workspace, issueTitles, statusChanges]) => [
      workspace,
      { issueTitles, statusChanges },
    ]),
  );

  return notifications.map((notification) => {
    const source = contextByWorkspace.get(notification.workspace);
    const statusChangeKey = activityReferenceKey(
      notification.reef_id,
      notification.source_ref,
    );
    const statusChangeContext =
      notification.event_type === ACTIVITY_EVENT_STATUS_CHANGE
        ? (source?.statusChanges.get(statusChangeKey) ?? {
            availability: "unavailable" as const,
            from: null,
            to: null,
          })
        : null;

    return parseInput(PersonalNotificationSchema, {
      ...notification,
      issue_context: source?.issueTitles.get(notification.reef_id) ?? {
        availability: "unavailable",
        title: null,
      },
      status_change_context: statusChangeContext,
    });
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

export async function listPersonalNotifications(
  adapter: AkbAdapter,
  input: PersonalNotificationListInput,
): Promise<PersonalNotification[]> {
  const parsed = parseInput(PersonalNotificationListInputSchema, input);
  const workspaces = validatedPersonalWorkspaces(parsed.workspaces);
  return withSpan(
    "akb.notifications.list_personal",
    { workspace_count: workspaces.length },
    async (span) => {
      if (workspaces.length === 0) {
        span.setAttribute("notification_count", 0);
        return [];
      }

      const primaryVault = workspaces[0];
      if (!primaryVault) {
        throw new SchemaValidationError({
          issues: ["notification workspaces are required"],
        });
      }
      const params = new SqlParameterBuilder();
      const recipient = params.add(parsed.recipient, "notification recipient");
      const branches = workspaces.map((workspace) => {
        const workspaceParameter = params.add(
          workspace,
          "notification workspace",
        );
        const table = crossVaultTableRef(workspace, REEF_NOTIFICATIONS_TABLE);
        return `SELECT ${canonicalTableSelectColumns(REEF_NOTIFICATIONS_TABLE, "notification_rows")}, ${workspaceParameter} AS workspace FROM ${table} AS notification_rows WHERE notification_rows.recipient = ${recipient} AND notification_rows.state IN ('unread', 'read') AND notification_rows.archived_at IS NULL`;
      });
      const limit = params.add(100, "notification list limit");
      const response = await runSql(
        adapter,
        primaryVault,
        `WITH scoped_notifications AS (${branches.join(" UNION ALL ")}), ranked_notifications AS (SELECT scoped_notifications.*, ROW_NUMBER() OVER (PARTITION BY state ORDER BY occurred_at::timestamptz DESC, workspace ASC, id DESC) AS state_rank FROM scoped_notifications) SELECT id, notification_key, recipient, reef_id, source_type, source_ref, event_type, actor, occurred_at, state, read_at, archived_at, payload, meta, workspace FROM ranked_notifications WHERE state_rank <= ${limit} ORDER BY occurred_at::timestamptz DESC, workspace ASC, id DESC`,
        params.params,
        workspaces,
      );
      if (response.kind !== "table_query") {
        throw new SchemaValidationError({
          issues: ["notification query returned an invalid response"],
        });
      }
      const rows = response.items;
      const baseNotifications = rows.map(personalNotificationBaseFromRow);
      const notifications = (
        await enrichPersonalNotifications(adapter, baseNotifications)
      ).sort((left, right) => {
        const timeOrder =
          Date.parse(right.occurred_at) - Date.parse(left.occurred_at);
        if (timeOrder !== 0) return timeOrder;
        if (left.workspace !== right.workspace) {
          return left.workspace < right.workspace ? -1 : 1;
        }
        return left.id > right.id ? -1 : left.id < right.id ? 1 : 0;
      });
      span.setAttribute("notification_count", notifications.length);
      return notifications;
    },
  );
}

function personalNotificationTargetKey(
  target: PersonalNotificationTarget,
): string {
  return JSON.stringify([target.workspace, target.notification_key]);
}

/**
 * Captures the actor's unread identities at request time, then conditionally
 * marks only that fixed set as read. Supplying `targets` applies a prior
 * snapshot's unresolved subset without taking another snapshot.
 */
export async function markAllPersonalNotificationsRead(
  adapter: AkbAdapter,
  input: PersonalNotificationReadAllInput,
): Promise<PersonalNotificationReadAllResult> {
  const parsed = parseInput(PersonalNotificationReadAllInputSchema, input);
  const workspaces = validatedPersonalWorkspaces(parsed.workspaces);
  const targetKeys = new Set<string>();
  for (const target of parsed.targets ?? []) {
    const key = personalNotificationTargetKey(target);
    if (targetKeys.has(key)) {
      throw new SchemaValidationError({
        issues: ["notification targets must be unique by workspace and key"],
      });
    }
    targetKeys.add(key);
  }

  return withSpan(
    "akb.notifications.mark_all_personal_read",
    { workspace_count: workspaces.length },
    async (span) => {
      let targets = parsed.targets;
      if (targets === undefined) {
        if (workspaces.length === 0) targets = [];
        else {
          const primaryVault = workspaces[0];
          if (!primaryVault) {
            throw new SchemaValidationError({
              issues: ["notification workspaces are required"],
            });
          }
          const params = new SqlParameterBuilder();
          const recipient = params.add(
            parsed.recipient,
            "notification recipient",
          );
          const branches = workspaces.map((workspace) => {
            const workspaceParameter = params.add(
              workspace,
              "notification workspace",
            );
            const table = crossVaultTableRef(
              workspace,
              REEF_NOTIFICATIONS_TABLE,
            );
            return `SELECT ${workspaceParameter} AS workspace, notification_rows.notification_key FROM ${table} AS notification_rows WHERE notification_rows.recipient = ${recipient} AND notification_rows.state = 'unread' AND notification_rows.archived_at IS NULL`;
          });
          const response = await runSql(
            adapter,
            primaryVault,
            branches.join(" UNION ALL "),
            params.params,
            workspaces,
          );
          if (response.kind !== "table_query") {
            throw new SchemaValidationError({
              issues: ["notification snapshot returned an invalid response"],
            });
          }
          targets = response.items.map((row) =>
            parseInput(PersonalNotificationTargetSchema, row),
          );
        }
      }

      span.setAttribute("target_count", targets.length);
      const completed: PersonalNotificationReadAllResult["completed"] = [];
      const unresolved: PersonalNotificationTarget[] = [];
      const allowedWorkspaces = new Set(workspaces);
      const targetsByWorkspace = new Map<
        string,
        PersonalNotificationTarget[]
      >();
      for (const target of targets) {
        if (!allowedWorkspaces.has(target.workspace)) {
          unresolved.push(target);
          continue;
        }
        const workspaceTargets = targetsByWorkspace.get(target.workspace) ?? [];
        workspaceTargets.push(target);
        targetsByWorkspace.set(target.workspace, workspaceTargets);
      }

      for (const [workspace, workspaceTargets] of targetsByWorkspace) {
        try {
          const params = new SqlParameterBuilder();
          const keys = params.addJson(
            workspaceTargets.map(({ notification_key }) => notification_key),
            "notification target keys",
            "jsonb",
          );
          const changedAt = params.add(
            new Date().toISOString(),
            "notification changed at",
          );
          const recipient = params.add(
            parsed.recipient,
            "notification recipient",
          );
          const response = await runSql(
            adapter,
            workspace,
            `WITH requested AS (SELECT jsonb_array_elements_text(${keys}) AS notification_key), updated AS (UPDATE ${tableRef(
              REEF_NOTIFICATIONS_TABLE,
            )} AS notification_rows SET state = 'read', read_at = COALESCE(notification_rows.read_at, ${changedAt}) FROM requested WHERE notification_rows.notification_key = requested.notification_key AND notification_rows.recipient = ${recipient} AND notification_rows.state = 'unread' AND notification_rows.archived_at IS NULL RETURNING notification_rows.notification_key, notification_rows.state, notification_rows.read_at), current AS (SELECT notification_rows.notification_key, notification_rows.state, notification_rows.read_at FROM ${tableRef(
              REEF_NOTIFICATIONS_TABLE,
            )} AS notification_rows JOIN requested ON requested.notification_key = notification_rows.notification_key WHERE notification_rows.recipient = ${recipient}) SELECT requested.notification_key, COALESCE(updated.state, current.state) AS state, COALESCE(updated.read_at, current.read_at) AS read_at FROM requested LEFT JOIN updated USING (notification_key) LEFT JOIN current USING (notification_key)`,
            params.params,
          );
          if (response.kind !== "table_query") {
            throw new SchemaValidationError({
              issues: ["notification update returned an invalid response"],
            });
          }
          const rowsByKey = new Map(
            response.items.map((row) => [String(row.notification_key), row]),
          );
          for (const target of workspaceTargets) {
            const row = rowsByKey.get(target.notification_key);
            const state = row?.state;
            if (
              state === "unread" ||
              (row && !["read", "archived"].includes(String(state)))
            ) {
              unresolved.push(target);
              continue;
            }
            const readAt = row?.read_at == null ? null : row.read_at;
            completed.push({
              ...target,
              state: state === "read" || state === "archived" ? state : null,
              read_at: readAt as string | null,
            });
          }
        } catch {
          unresolved.push(...workspaceTargets);
        }
      }

      const result = parseInput(PersonalNotificationReadAllResultSchema, {
        targets,
        completed,
        unresolved,
      });
      span.setAttribute("completed_count", result.completed.length);
      span.setAttribute("unresolved_count", result.unresolved.length);
      return result;
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
