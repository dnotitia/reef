import type {
  ActivityDraftSuggestion,
  ActivityStatusChangeSuggestion,
  RecentActivityEvent,
} from "@reef/core";

interface AiDraftItem {
  id: string;
  type: "ai_draft";
  timestamp: string;
  /** Source AKB activity suggestion. */
  draft: ActivityDraftSuggestion;
}

interface AiStatusChangeItem {
  id: string;
  type: "ai_status_change";
  timestamp: string;
  /** Linked issue ID — consistently present (tracked branch). */
  issueId: string;
  /** Linked issue title cached at scan time for inbox rendering. */
  issueTitle: string;
  /** Source AKB activity suggestion. */
  statusChange: ActivityStatusChangeSuggestion;
}

/**
 * A recorded issue change (REEF-063 `reef_activity` event) surfaced as an
 * informational feed item — what actually happened to an issue, not an AI
 * proposal awaiting review. It carries no review actions and uses the neutral,
 * non-AI card treatment so a fact is never mistaken for a suggestion (REEF-077).
 */
interface IssueChangeItem {
  id: string;
  type: "issue_change";
  timestamp: string;
  /** The issue this change belongs to. */
  issueId: string;
  /** The issue's current title, joined in at read time for the feed link. */
  issueTitle: string;
  /** Source immutable issue activity event. */
  event: RecentActivityEvent;
}

/**
 * Discriminated union — one variant per `type`. TypeScript narrows
 * `item.draft` / `item.statusChange` / `item.event` automatically inside
 * `if (item.type === "ai_draft")` blocks, eliminating the optional-field guard
 * pattern of the prior flat shape.
 */
export type ActivityFeedItem =
  | AiDraftItem
  | AiStatusChangeItem
  | IssueChangeItem;
