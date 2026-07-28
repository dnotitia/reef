import { describe, expect, it } from "vitest";
import {
  REEF_DESIRED_TABLES,
  REEF_NOTIFICATIONS_TABLE,
  REEF_SCHEMA_VERSION,
  REEF_SUBSCRIPTIONS_TABLE,
} from "../index";

describe("notification storage manifest", () => {
  it("preserves the existing table names and order before the additive tables", () => {
    expect(REEF_DESIRED_TABLES.slice(0, 11).map((table) => table.name)).toEqual(
      [
        "reef_settings",
        "monitored_repos",
        "reef_issues",
        "reef_sprints",
        "reef_milestones",
        "reef_releases",
        "reef_templates",
        "reef_activity_suggestions",
        "reef_comments",
        "reef_attachments",
        "reef_activity",
      ],
    );
  });

  it("declares the additive schema version and both complete create-time tables", () => {
    expect(REEF_SCHEMA_VERSION).toBe(2);
    expect(REEF_DESIRED_TABLES).toHaveLength(13);

    const notifications = REEF_DESIRED_TABLES.find(
      (table) => table.name === REEF_NOTIFICATIONS_TABLE,
    );
    expect(notifications).toMatchObject({
      unique_keys: [
        { columns: ["notification_key"] },
        { columns: ["recipient", "source_type", "source_ref"] },
      ],
      indexes: [
        {
          columns: [
            "recipient",
            "state",
            { name: "occurred_at", order: "desc" },
          ],
        },
      ],
    });
    expect(notifications?.columns.map((column) => column.name)).toEqual([
      "notification_key",
      "recipient",
      "reef_id",
      "source_type",
      "source_ref",
      "event_type",
      "actor",
      "occurred_at",
      "state",
      "read_at",
      "archived_at",
      "payload",
      "meta",
    ]);

    const subscriptions = REEF_DESIRED_TABLES.find(
      (table) => table.name === REEF_SUBSCRIPTIONS_TABLE,
    );
    expect(subscriptions).toMatchObject({
      unique_keys: [
        { columns: ["subscription_key"] },
        { columns: ["reef_id", "subscriber", "source"] },
      ],
      indexes: [{ columns: ["reef_id", "status", "subscriber"] }],
    });
  });
});
