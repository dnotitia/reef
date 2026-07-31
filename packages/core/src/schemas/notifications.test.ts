import { describe, expect, it } from "vitest";
import {
  EffectiveSubscriptionStateSchema,
  NotificationCreateInputSchema,
  NotificationListInputSchema,
  NotificationStateSchema,
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
    ).toBe(
      buildNotificationKey({
        recipient: "kim",
        sourceType: "issue_activity",
        sourceRef: "REEF-1:status_change",
      }),
    );
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
    expect(NotificationStateSchema.safeParse("seen").success).toBe(false);
    expect(SubscriptionSourceSchema.safeParse("imported").success).toBe(false);
    expect(
      NotificationCreateInputSchema.safeParse({
        recipient: "",
        reefId: "REEF-1",
        sourceType: "issue_activity",
        sourceRef: "ref",
        eventType: "status_change",
        actor: "kim",
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
      NotificationListInputSchema.safeParse({
        recipient: "kim",
        limit: 101,
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
