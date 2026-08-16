import { z } from "zod";

const NonEmptyIdentitySchema = z.string().trim().min(1);
const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const NotificationStateSchema = z.enum(["unread", "read", "archived"]);
export const SubscriptionSourceSchema = z.enum([
  "manual",
  "requester",
  "assignee",
  "commenter",
]);
export const SubscriptionStatusSchema = z.enum(["active", "muted"]);
export const EffectiveSubscriptionStateSchema = z.enum([
  "muted",
  "watching",
  "unwatched",
]);

export const NotificationIdentitySchema = z.strictObject({
  recipient: NonEmptyIdentitySchema,
  sourceType: NonEmptyIdentitySchema,
  sourceRef: NonEmptyIdentitySchema,
});

export const NotificationCreateInputSchema = NotificationIdentitySchema.extend({
  notificationKey: NonEmptyIdentitySchema.optional(),
  reefId: NonEmptyIdentitySchema,
  eventType: NonEmptyIdentitySchema,
  actor: NonEmptyIdentitySchema,
  occurredAt: IsoDateTimeSchema,
  payload: z.unknown().nullable().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const NotificationListInputSchema = z.strictObject({
  recipient: NonEmptyIdentitySchema,
  state: NotificationStateSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const NotificationStateUpdateInputSchema = z.strictObject({
  notificationKey: NonEmptyIdentitySchema,
  recipient: NonEmptyIdentitySchema,
  state: NotificationStateSchema,
  changedAt: IsoDateTimeSchema.optional(),
});

export const NotificationRowSchema = z.looseObject({
  id: z.uuid(),
  notification_key: NonEmptyIdentitySchema,
  recipient: NonEmptyIdentitySchema,
  reef_id: NonEmptyIdentitySchema,
  source_type: NonEmptyIdentitySchema,
  source_ref: NonEmptyIdentitySchema,
  event_type: NonEmptyIdentitySchema,
  actor: NonEmptyIdentitySchema,
  occurred_at: IsoDateTimeSchema,
  state: NotificationStateSchema,
  read_at: IsoDateTimeSchema.nullable().optional(),
  archived_at: IsoDateTimeSchema.nullable().optional(),
  payload: z.unknown().nullable().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const SubscriptionIdentitySchema = z.strictObject({
  reefId: NonEmptyIdentitySchema,
  subscriber: NonEmptyIdentitySchema,
  source: SubscriptionSourceSchema,
});

export const SubscriptionUpsertInputSchema = SubscriptionIdentitySchema.extend({
  subscriptionKey: NonEmptyIdentitySchema.optional(),
  status: SubscriptionStatusSchema.default("active"),
  subscribedAt: IsoDateTimeSchema.optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const SubscriptionListInputSchema = z.strictObject({
  reefId: NonEmptyIdentitySchema,
  subscriber: NonEmptyIdentitySchema.optional(),
  status: SubscriptionStatusSchema.optional(),
});

export const SubscriptionRowSchema = z.looseObject({
  id: z.uuid(),
  subscription_key: NonEmptyIdentitySchema,
  reef_id: NonEmptyIdentitySchema,
  subscriber: NonEmptyIdentitySchema,
  source: SubscriptionSourceSchema,
  status: SubscriptionStatusSchema,
  subscribed_at: IsoDateTimeSchema,
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type NotificationState = z.infer<typeof NotificationStateSchema>;
export type NotificationIdentity = z.infer<typeof NotificationIdentitySchema>;
export type NotificationCreateInput = z.infer<
  typeof NotificationCreateInputSchema
>;
export type NotificationListInput = z.input<typeof NotificationListInputSchema>;
export type NotificationStateUpdateInput = z.infer<
  typeof NotificationStateUpdateInputSchema
>;
export type Notification = z.infer<typeof NotificationRowSchema>;
export type SubscriptionSource = z.infer<typeof SubscriptionSourceSchema>;
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;
export type EffectiveSubscriptionState = z.infer<
  typeof EffectiveSubscriptionStateSchema
>;
export type SubscriptionIdentity = z.infer<typeof SubscriptionIdentitySchema>;
export type SubscriptionUpsertInput = z.input<
  typeof SubscriptionUpsertInputSchema
>;
export type SubscriptionListInput = z.infer<typeof SubscriptionListInputSchema>;
export type Subscription = z.infer<typeof SubscriptionRowSchema>;

function identityKey(namespace: string, parts: readonly string[]): string {
  return `${namespace}:${parts.map((part) => `${part.length}:${part}`).join(":")}`;
}

export function buildNotificationKey(identity: NotificationIdentity): string {
  const parsed = NotificationIdentitySchema.parse(identity);
  return identityKey("notification", [
    parsed.recipient,
    parsed.sourceType,
    parsed.sourceRef,
  ]);
}

export function buildSubscriptionKey(identity: SubscriptionIdentity): string {
  const parsed = SubscriptionIdentitySchema.parse(identity);
  return identityKey("subscription", [
    parsed.reefId,
    parsed.subscriber,
    parsed.source,
  ]);
}

export function effectiveSubscriptionState(
  subscriptions: ReadonlyArray<
    | Pick<Subscription, "source" | "status">
    | {
        source: SubscriptionSource;
        status: SubscriptionStatus;
      }
  >,
): EffectiveSubscriptionState {
  if (subscriptions.some((subscription) => subscription.status === "muted")) {
    return "muted";
  }
  if (subscriptions.some((subscription) => subscription.status === "active")) {
    return "watching";
  }
  return "unwatched";
}
