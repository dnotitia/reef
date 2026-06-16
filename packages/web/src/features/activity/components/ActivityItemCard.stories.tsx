import type { Meta, StoryObj } from "@storybook/react";
import type { ActivityFeedItem } from "../types";
import { ActivityItemCard } from "./ActivityItemCard";

const meta: Meta<typeof ActivityItemCard> = {
  title: "Activity/ActivityItemCard",
  component: ActivityItemCard,
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof ActivityItemCard>;

const aiDraftItem: ActivityFeedItem = {
  id: "reef-draft-550e8400e29b41d4",
  type: "ai_draft",
  timestamp: "2026-04-13T11:00:00.000Z",
  draft: {
    id: "reef-draft-550e8400e29b41d4",
    kind: "draft",
    proposal: {
      operation: "create",
      create: {
        fields: {
          title: "Add rate limiting to API endpoints",
          priority: "high",
          labels: ["security", "backend"],
        },
        content:
          "Several API endpoints lack rate limiting, which could allow abuse. Suggest adding a rate limiting middleware.",
      },
    },
    repo: "owner/reef",
    fingerprint: "owner/reef:commit:a1b2c3d4e5f6",
    provenance: {
      type: "commit",
      ref: "a1b2c3d4e5f6",
      repo: "owner/reef",
      actor: "github-actions[bot]",
      detectedAt: "2026-04-13T11:00:00.000Z",
    },
    confidence: 0.88,
    reasoning:
      "The commit added several new API endpoints without rate limiting, matching patterns for security issues.",
    status: "pending",
    created_at: "2026-04-13T11:00:00.000Z",
    detected_at: "2026-04-13T11:00:00.000Z",
  },
};

const aiStatusChangeItem: ActivityFeedItem = {
  id: "reef-status-550e8400e29b41d4",
  type: "ai_status_change",
  timestamp: "2026-04-13T11:30:00.000Z",
  issueId: "REEF-101",
  issueTitle: "Implement user authentication flow",
  statusChange: {
    id: "reef-status-550e8400e29b41d4",
    kind: "status_change",
    status: "pending",
    repo: "owner/reef",
    fingerprint: "REEF-101:owner/reef:pr:294",
    proposal: {
      operation: "update",
      update: {
        issue_id: "REEF-101",
        patch: { status: "done" },
      },
    },
    issue_title: "Implement user authentication flow",
    from_status: "in_review",
    rationale:
      "Authentication callbacks now preserve the workspace session and redirect users back to the board after sign-in.",
    evidence: [{ type: "pr", ref: "294", repo: "owner/reef", actor: "dev" }],
    confidence: 0.9,
    created_at: "2026-04-13T11:30:00.000Z",
    detected_at: "2026-04-13T11:30:00.000Z",
  },
};

export const AiDraftWithApproveAndDismiss: Story = {
  args: {
    item: aiDraftItem,
    onApproveDraft: async (draft) => {
      console.log("Approved draft:", draft.id);
    },
    onDismissDraft: (id) => {
      console.log("Dismissed draft:", id);
    },
  },
};

export const AiDraftApproving: Story = {
  args: {
    item: aiDraftItem,
    isApproving: true,
    onApproveDraft: async () => {},
    onDismissDraft: () => {},
  },
};

export const AiStatusChangeWithApproveAndDismiss: Story = {
  args: {
    item: aiStatusChangeItem,
    onApproveStatusChange: async (statusChange) => {
      console.log("Approved status change:", statusChange.id);
    },
    onDismissStatusChange: (id) => {
      console.log("Dismissed status change:", id);
    },
  },
};
