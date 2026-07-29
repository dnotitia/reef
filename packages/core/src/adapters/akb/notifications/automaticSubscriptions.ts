import {
  type SubscriptionSource,
  buildSubscriptionKey,
} from "../../../schemas/notifications";
import {
  type AkbAdapter,
  REEF_ISSUES_TABLE,
  REEF_SUBSCRIPTIONS_TABLE,
  quoteText,
  runSql,
  tableRef,
} from "../core/shared";

export type AutomaticSubscriptionSource = Exclude<SubscriptionSource, "manual">;

export interface AutomaticSubscriptionParticipant {
  source: AutomaticSubscriptionSource;
  subscriber: string | null | undefined;
}

interface AutomaticSubscriptionCtesInput {
  anchorCte: string;
  reefId: string;
  participants: readonly AutomaticSubscriptionParticipant[];
  subscribedAt: string;
  reconcile: boolean;
}

function normalizedSubscriber(
  subscriber: string | null | undefined,
): string | null {
  const normalized = subscriber?.trim();
  return normalized ? normalized : null;
}

/**
 * Build data-modifying CTEs that share the transaction of an issue/comment
 * mutation. Every CTE is gated by `anchorCte`, so no automatic source can
 * commit unless the canonical body row mutation (or replay readback) exists.
 *
 * Reconciliation addresses only the named automatic source. It never touches
 * `manual`, so an independent manual mute remains authoritative.
 */
export function automaticSubscriptionCtes(
  input: AutomaticSubscriptionCtesInput,
): string[] {
  const ctes: string[] = [];
  for (const participant of input.participants) {
    const subscriber = normalizedSubscriber(participant.subscriber);
    const source = participant.source;
    if (input.reconcile) {
      ctes.push(
        `automatic_${source}_removed AS (DELETE FROM ${tableRef(
          REEF_SUBSCRIPTIONS_TABLE,
        )} AS automatic_subscription USING ${
          input.anchorCte
        } WHERE automatic_subscription.reef_id = ${quoteText(
          input.reefId,
          "subscription reef id",
        )} AND automatic_subscription.source = ${quoteText(
          source,
          "subscription source",
        )} AND automatic_subscription.subscriber IS DISTINCT FROM ${
          subscriber === null
            ? "NULL"
            : quoteText(subscriber, "subscription subscriber")
        } RETURNING id)`,
      );
    }
    if (subscriber === null) continue;
    const key = buildSubscriptionKey({
      reefId: input.reefId,
      subscriber,
      source,
    });
    ctes.push(
      `automatic_${source}_upserted AS (INSERT INTO ${tableRef(
        REEF_SUBSCRIPTIONS_TABLE,
      )} (subscription_key, reef_id, subscriber, source, status, subscribed_at, meta) SELECT ${quoteText(
        key,
        "subscription key",
      )}, ${quoteText(input.reefId, "subscription reef id")}, ${quoteText(
        subscriber,
        "subscription subscriber",
      )}, ${quoteText(source, "subscription source")}, 'active', ${quoteText(
        input.subscribedAt,
        "subscription subscribed at",
      )}, NULL FROM ${
        input.anchorCte
      } ON CONFLICT (subscription_key) DO UPDATE SET status = 'active' RETURNING id)`,
    );
  }
  return ctes;
}

/**
 * Remove automatic participant rows that no longer match the canonical issue
 * row, using a fresh SQL statement snapshot.
 *
 * The mutation statement already inserts the intended active sources
 * atomically with the issue row. This follow-up is the concurrency fence for
 * overlapping last-write-wins updates: the final writer necessarily runs this
 * statement after its own row mutation, so it can observe and remove any
 * obsolete source inserted by an earlier overlapping transaction whose
 * original statement snapshot could not see the later row.
 */
export async function reconcilePersistedAutomaticSubscriptions(
  adapter: AkbAdapter,
  vault: string,
  reefId: string,
): Promise<void> {
  await runSql(
    adapter,
    vault,
    `WITH canonical_participants AS MATERIALIZED (SELECT reef_id, NULLIF(BTRIM(requester), '') AS requester, NULLIF(BTRIM(assigned_to), '') AS assigned_to FROM ${tableRef(
      REEF_ISSUES_TABLE,
    )} WHERE reef_id = ${quoteText(
      reefId,
      "subscription reef id",
    )}), obsolete_automatic_subscriptions AS (DELETE FROM ${tableRef(
      REEF_SUBSCRIPTIONS_TABLE,
    )} AS automatic_subscription USING canonical_participants WHERE automatic_subscription.reef_id = canonical_participants.reef_id AND ((automatic_subscription.source = 'requester' AND automatic_subscription.subscriber IS DISTINCT FROM canonical_participants.requester) OR (automatic_subscription.source = 'assignee' AND automatic_subscription.subscriber IS DISTINCT FROM canonical_participants.assigned_to)) RETURNING automatic_subscription.id) SELECT reef_id FROM canonical_participants`,
  );
}
