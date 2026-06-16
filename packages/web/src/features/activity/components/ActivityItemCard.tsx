"use client";

import type {
  ActivityDraftSuggestion,
  ActivityStatusChangeSuggestion,
  Status,
} from "@reef/core";
import type { ActivityFeedItem } from "../types";
import {
  ActivityDraftCard,
  type ActivityDraftEditPatch,
} from "./ActivityDraftCard";
import { StatusChangeCard } from "./StatusChangeCard";

export type { ActivityDraftEditPatch };

interface ActivityItemCardProps {
  item: ActivityFeedItem;
  onApproveDraft?: (draft: ActivityDraftSuggestion) => Promise<void>;
  onDismissDraft?: (draftId: string) => void;
  onSaveDraftEdits?: (
    draftId: string,
    edits: ActivityDraftEditPatch,
  ) => Promise<void>;
  onApproveStatusChange?: (
    statusChange: ActivityStatusChangeSuggestion,
  ) => Promise<void>;
  onDismissStatusChange?: (statusChangeId: string) => void;
  onSaveStatusChange?: (
    statusChangeId: string,
    toStatus: Status,
  ) => Promise<void>;
  /** Active akb vault, used for assignee lookup while editing AI drafts. */
  vault?: string;
  /** Approving state keyed by item.id — passed through to disable buttons. */
  isApproving?: boolean;
}

/**
 * Dense, scannable activity card. Dispatches on `item.type` to a sub-component;
 * TypeScript narrows `item` per branch so each sub-component sees its variant's
 * full shape without optional-field guards.
 */
export function ActivityItemCard({
  item,
  onApproveDraft,
  onDismissDraft,
  onSaveDraftEdits,
  onApproveStatusChange,
  onDismissStatusChange,
  onSaveStatusChange,
  isApproving = false,
  vault = "",
}: ActivityItemCardProps) {
  switch (item.type) {
    case "ai_draft":
      return (
        <ActivityDraftCard
          item={item}
          onApprove={onApproveDraft}
          onDismiss={onDismissDraft}
          onSaveEdits={onSaveDraftEdits}
          vault={vault}
          isApproving={isApproving}
        />
      );
    case "ai_status_change":
      return (
        <StatusChangeCard
          item={item}
          onApprove={onApproveStatusChange}
          onDismiss={onDismissStatusChange}
          onSaveTarget={onSaveStatusChange}
          isApproving={isApproving}
        />
      );
  }
}
