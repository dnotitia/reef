import { describe, expect, it } from "vitest";
import {
  EffectiveSubscriptionStateSchema,
  NotificationCreateInputSchema,
  NotificationStateSchema,
  PersonalNotificationListInputSchema,
  PersonalNotificationSchema,
  SubscriptionSourceSchema,
  SubscriptionUpsertInputSchema,
  buildNotificationKey,
  buildSubscriptionKey,
  effectiveSubscriptionState,
} from "../index";

describe("notification and subscription contracts", () => {
  it("builds deterministic, identity-safe public keys", () => {
    expect(
      buildNotificationKey({
        recipient: "kim",
        sourceType: "issue_activity",
        sourceRef: "REEF-1:status_change",
      }),
    ).toBe("notification:3:kim:14:issue_activity:20:REEF-1:status_change");
    expect(
      buildSubscriptionKey({
        reefId: "REEF-1",
        subscriber: "kim",
        source: "manual",
      }),
    ).toBe("subscription:6:REEF-1:3:kim:6:manual");
    expect(
      buildNotificationKey({
        recipient: "ki",
        sourceType: "missue_activity",
        sourceRef: "REEF-1:status_change",
      }),
    ).not.toBe(
      buildNotificationKey({
        recipient: "kim",
        sourceType: "issue_activity",
        sourceRef: "REEF-1:status_change",
      }),
    );
    expect(
      buildSubscriptionKey({
        reefId: "R",
        subscriber: "EEF-1kim",
        source: "manual",
      }),
    ).not.toBe(
      buildSubscriptionKey({
        reefId: "REEF-1",
        subscriber: "kim",
        source: "manual",
      }),
    );
  });

  it("rejects invalid boundary data before it reaches an adapter", () => {
    const notification = {
      recipient: "kim",
      reefId: "REEF-1",
      sourceType: "issue_activity",
      sourceRef: "ref",
      eventType: "status_change",
      actor: "lee",
      occurredAt: "2026-07-28T00:00:00.000Z",
    };
    expect(NotificationCreateInputSchema.safeParse(notification).success).toBe(
      true,
    );
    expect(NotificationStateSchema.safeParse("seen").success).toBe(false);
    expect(SubscriptionSourceSchema.safeParse("imported").success).toBe(false);
    expect(
      NotificationCreateInputSchema.safeParse({
        ...notification,
        recipient: "",
      }).success,
    ).toBe(false);
    expect(
      NotificationCreateInputSchema.safeParse({
        ...notification,
        occurredAt: "not-a-date",
      }).success,
    ).toBe(false);
    expect(
      NotificationCreateInputSchema.safeParse({
        recipient: "kim",
        reefId: "REEF-1",
        sourceType: "issue_activity",
        sourceRef: "",
        eventType: "status_change",
        actor: "lee",
        occurredAt: "2026-07-28T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      SubscriptionUpsertInputSchema.safeParse({
        reefId: "",
        subscriber: "kim",
        source: "manual",
        status: "active",
      }).success,
    ).toBe(false);
    expect(
      PersonalNotificationListInputSchema.safeParse({
        recipient: "kim",
        workspaces: ["reef-acme", "Bad Name"],
      }).success,
    ).toBe(false);
  });

  it("validates source issue and original status-transition availability", () => {
    const notification = {
      id: "018f47a4-8e3b-7f62-a3d2-9876543210ab",
      notification_key: buildNotificationKey({
        recipient: "kim",
        sourceType: "issue_activity",
        sourceRef: "status:1",
      }),
      recipient: "kim",
      reef_id: "REEF-1",
      source_type: "issue_activity",
      source_ref: "status:1",
      event_type: "status_change",
      actor: "lee",
      occurred_at: "2026-07-28T00:00:00.000Z",
      state: "unread",
      workspace: "reef-alpha",
      issue_context: { availability: "available", title: "Alpha issue" },
      status_change_context: {
        availability: "available",
        from: "todo",
        to: "in_progress",
      },
    };

    expect(PersonalNotificationSchema.parse(notification)).toMatchObject(
      notification,
    );
    expect(
      PersonalNotificationSchema.safeParse({
        ...notification,
        issue_context: { availability: "unavailable", title: "Secret title" },
      }).success,
    ).toBe(false);
    expect(
      PersonalNotificationSchema.safeParse({
        ...notification,
        status_change_context: {
          availability: "available",
          from: "not-a-status",
          to: "in_progress",
        },
      }).success,
    ).toBe(false);
    expect(
      PersonalNotificationSchema.safeParse({
        ...notification,
        status_change_context: {
          availability: "unavailable",
          from: "todo",
          to: "in_progress",
        },
      }).success,
    ).toBe(false);
  });

  it("computes muted > watching > unwatched and lets manual watch clear mute", () => {
    expect(
      effectiveSubscriptionState([
        { source: "requester", status: "active" },
        { source: "manual", status: "muted" },
      ]),
    ).toBe("muted");
    expect(
      effectiveSubscriptionState([
        { source: "requester", status: "active" },
        { source: "manual", status: "active" },
      ]),
    ).toBe("watching");
    expect(effectiveSubscriptionState([])).toBe("unwatched");
    expect(EffectiveSubscriptionStateSchema.options).toEqual([
      "muted",
      "watching",
      "unwatched",
    ]);
  });
});
