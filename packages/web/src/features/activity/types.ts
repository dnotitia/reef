import type {
  ActivityDraftSuggestion,
  ActivityStatusChangeSuggestion,
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
 * Discriminated union — one variant per `type`. TypeScript narrows
 * `item.draft` / `item.statusChange` automatically inside
 * `if (item.type === "ai_draft")` blocks, eliminating the optional-field guard
 * pattern of the prior flat shape.
 */
export type ActivityFeedItem = AiDraftItem | AiStatusChangeItem;
