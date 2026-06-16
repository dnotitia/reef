import { describe, expect, it } from "vitest";
import type {
  PendingDraft,
  PendingStatusChange,
} from "../schemas/activity/pendingDraft";
import {
  activityDraftFingerprint,
  activityStatusChangeFingerprint,
  activitySuggestionId,
  draftToActivitySuggestion,
  statusChangeToActivitySuggestion,
} from "./activitySuggestion";

const DRAFT: PendingDraft = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  proposal: {
    operation: "create",
    create: {
      fields: {
        title: "Add rate limiting",
        priority: "high",
        assigned_to: "alice",
        labels: ["security"],
        blocks: ["REEF-099"],
      },
      content: "A new route needs throttling.",
    },
  },
  provenance: {
    type: "commit",
    ref: "abc123",
    repo: "owner/reef",
    actor: "bot",
    detectedAt: "2026-05-10T00:00:00.000Z",
  },
  confidence: 0.9,
  reasoning: "The route is public.",
  status: "pending",
  createdAt: "2026-05-10T00:00:00.000Z",
};

const STATUS_CHANGE: PendingStatusChange = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  proposal: {
    operation: "update",
    update: {
      issue_id: "REEF-001",
      patch: { status: "done" },
    },
  },
  issueTitle: "Fix login",
  fromStatus: "in_review",
  rationale:
    "PR #42 implementing the login fix was merged, completing the work.",
  evidence: [
    { type: "pr", ref: "42", repo: "owner/reef", actor: "dev" },
    { type: "commit", ref: "abc123", repo: "owner/reef", actor: "dev" },
  ],
  confidence: 0.9,
  detectedAt: "2026-05-11T00:00:00.000Z",
  status: "pending",
  createdAt: "2026-05-11T00:00:00.000Z",
};

describe("activity suggestion model helpers", () => {
  it("creates deterministic draft ids from fingerprint hashes", async () => {
    const fingerprint = activityDraftFingerprint(DRAFT);
    expect(fingerprint).toBe("owner/reef:commit:abc123");
    const first = await activitySuggestionId("draft", fingerprint);
    const second = await activitySuggestionId("draft", fingerprint);
    expect(first).toBe(second);
    expect(first).toMatch(/^reef-draft-[a-f0-9]{16}$/);
  });

  it("sorts status-change evidence before fingerprinting", () => {
    const reversed: PendingStatusChange = {
      ...STATUS_CHANGE,
      evidence: [...STATUS_CHANGE.evidence].reverse(),
    };
    expect(activityStatusChangeFingerprint(STATUS_CHANGE)).toBe(
      activityStatusChangeFingerprint(reversed),
    );
  });

  it("includes the target status in the status-change fingerprint", () => {
    const reopened: PendingStatusChange = {
      ...STATUS_CHANGE,
      proposal: {
        operation: "update",
        update: {
          ...STATUS_CHANGE.proposal.update,
          patch: { status: "closed" },
        },
      },
    };
    expect(activityStatusChangeFingerprint(STATUS_CHANGE)).not.toBe(
      activityStatusChangeFingerprint(reopened),
    );
  });

  it("maps pending drafts into AKB activity suggestions", async () => {
    const suggestion = await draftToActivitySuggestion(DRAFT);
    expect(suggestion).toMatchObject({
      kind: "draft",
      status: "pending",
      repo: "owner/reef",
      created_at: "2026-05-10T00:00:00.000Z",
      detected_at: "2026-05-10T00:00:00.000Z",
      proposal: DRAFT.proposal,
    });
    expect(suggestion.id).toMatch(/^reef-draft-[a-f0-9]{16}$/);
  });

  it("omits null priority when mapping pending drafts", async () => {
    const suggestion = await draftToActivitySuggestion({
      ...DRAFT,
      proposal: {
        operation: "create",
        create: {
          ...DRAFT.proposal.create,
          fields: { ...DRAFT.proposal.create.fields, priority: null },
        },
      },
    });

    expect(suggestion.proposal.create.fields.priority).toBeNull();
  });

  it("maps pending status changes into AKB activity suggestions", async () => {
    const suggestion = await statusChangeToActivitySuggestion(STATUS_CHANGE);
    expect(suggestion).toMatchObject({
      kind: "status_change",
      status: "pending",
      repo: "owner/reef",
      created_at: "2026-05-11T00:00:00.000Z",
      detected_at: "2026-05-11T00:00:00.000Z",
      proposal: STATUS_CHANGE.proposal,
      issue_title: "Fix login",
      from_status: "in_review",
      rationale:
        "PR #42 implementing the login fix was merged, completing the work.",
      confidence: 0.9,
    });
    expect(suggestion.id).toMatch(/^reef-status-[a-f0-9]{16}$/);
  });
});
