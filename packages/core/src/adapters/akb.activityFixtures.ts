import type {
  ActivityDraftSuggestion,
  ActivityStatusChangeSuggestion,
} from "../schemas/activity/suggestion";

export const SAMPLE_DRAFT_SUGGESTION: ActivityDraftSuggestion = {
  id: "reef-draft-0123456789abcdef",
  kind: "draft",
  status: "pending",
  fingerprint: "owner/reef:commit:abc123",
  repo: "owner/reef",
  created_at: "2026-05-11T00:00:00.000Z",
  detected_at: "2026-05-11T00:00:00.000Z",
  proposal: {
    operation: "create",
    create: {
      fields: {
        title: "Investigate missing rate limit",
        priority: "high",
        assigned_to: "alice",
        labels: ["security"],
      },
      content: "A new endpoint was added without a rate limit.",
    },
  },
  provenance: {
    type: "commit",
    ref: "abc123",
    repo: "owner/reef",
    actor: "bot",
    detectedAt: "2026-05-11T00:00:00.000Z",
  },
  confidence: 0.82,
  reasoning: "The activity touched an unauthenticated endpoint.",
};

export const SAMPLE_STATUS_CHANGE_SUGGESTION: ActivityStatusChangeSuggestion = {
  id: "reef-status-0123456789abcdef",
  kind: "status_change",
  status: "pending",
  fingerprint: "REEF-001|done|owner/reef:pr:42",
  repo: "owner/reef",
  created_at: "2026-05-12T00:00:00.000Z",
  detected_at: "2026-05-12T00:00:00.000Z",
  proposal: {
    operation: "update",
    update: {
      issue_id: "REEF-001",
      patch: { status: "done" },
    },
  },
  issue_title: "Fix the login flow",
  from_status: "in_review",
  rationale: "PR #42 wiring the callback redirect was merged.",
  evidence: [{ type: "pr", ref: "42", repo: "owner/reef", actor: "dev" }],
  confidence: 0.9,
};

export const ACTIVITY_SUGGESTION_ROW_COLUMNS = [
  "id",
  "document_uri",
  "suggestion_id",
  "kind",
  "status",
  "fingerprint",
  "repo",
  "issue_id",
  "title",
  "summary",
  "source_type",
  "source_ref",
  "actor",
  "detected_at",
  "reviewed_at",
  "reviewed_by",
  "meta",
  "created_at",
  "updated_at",
  "created_by",
];

export function makeActivitySuggestionRow(
  suggestion: ActivityDraftSuggestion | ActivityStatusChangeSuggestion,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const source =
    suggestion.kind === "draft"
      ? suggestion.provenance
      : suggestion.evidence[0];
  return {
    id: 1,
    document_uri: `akb://reef-sample/doc/_reef/activity-inbox/${suggestion.id}.md`,
    suggestion_id: suggestion.id,
    kind: suggestion.kind,
    status: suggestion.status,
    fingerprint: suggestion.fingerprint,
    repo: suggestion.repo,
    issue_id:
      suggestion.kind === "status_change"
        ? suggestion.proposal.update.issue_id
        : null,
    title:
      suggestion.kind === "draft"
        ? suggestion.proposal.create.fields.title
        : suggestion.issue_title,
    summary:
      suggestion.kind === "draft"
        ? suggestion.proposal.create.content.slice(0, 500)
        : suggestion.rationale,
    source_type: source?.type ?? "commit",
    source_ref: source?.ref ?? "",
    actor: source?.actor ?? "",
    detected_at: suggestion.detected_at,
    reviewed_at: suggestion.reviewed_at ?? null,
    reviewed_by: suggestion.reviewed_by ?? null,
    meta: suggestion,
    created_at: suggestion.created_at,
    updated_at: suggestion.created_at,
    created_by: "akb-principal",
    ...overrides,
  };
}
