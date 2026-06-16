import { describe, expect, it } from "vitest";
import { ActivitySuggestionSchema } from "./suggestion";

const base = {
  id: "reef-draft-0123456789abcdef",
  status: "pending",
  fingerprint: "octo/cat:commit:abc123",
  repo: "octo/cat",
  created_at: "2026-05-01T00:00:00.000Z",
  detected_at: "2026-05-01T00:00:00.000Z",
} as const;

describe("ActivitySuggestionSchema older normalizer", () => {
  it("normalizes older draft rows into create proposals", () => {
    const parsed = ActivitySuggestionSchema.parse({
      ...base,
      kind: "draft",
      title: "older draft",
      description: "older body",
      priority: "high",
      labels: ["auth"],
      provenance: {
        type: "commit",
        ref: "abc123",
        repo: "octo/cat",
        actor: "alice",
        detectedAt: "2026-05-01T00:00:00.000Z",
      },
      confidence: 0.8,
      reasoning: "Useful activity.",
    });

    expect(parsed.kind).toBe("draft");
    if (parsed.kind !== "draft") return;
    expect(parsed.proposal).toEqual({
      operation: "create",
      create: {
        fields: {
          title: "older draft",
          priority: "high",
          labels: ["auth"],
        },
        content: "older body",
      },
    });
  });

  it("normalizes older status-change rows into update proposals", () => {
    const parsed = ActivitySuggestionSchema.parse({
      ...base,
      id: "reef-status-0123456789abcdef",
      kind: "status_change",
      issue_id: "REEF-001",
      issue_title: "Existing issue",
      from_status: "in_review",
      to_status: "done",
      rationale: "The PR merged.",
      evidence: [{ type: "pr", ref: "42", repo: "octo/cat", actor: "alice" }],
      confidence: 0.9,
    });

    expect(parsed.kind).toBe("status_change");
    if (parsed.kind !== "status_change") return;
    expect(parsed.proposal).toEqual({
      operation: "update",
      update: {
        issue_id: "REEF-001",
        patch: { status: "done" },
      },
    });
  });

  it("keeps older status-change rows with empty evidence fields readable", () => {
    const parsed = ActivitySuggestionSchema.parse({
      ...base,
      id: "reef-status-0123456789abcdef",
      kind: "status_change",
      issue_id: "REEF-001",
      issue_title: "Existing issue",
      from_status: "in_review",
      to_status: "done",
      rationale: "The older row predates strict evidence validation.",
      evidence: [{ type: "pr", ref: "", repo: "", actor: "" }],
      confidence: 0.9,
    });

    expect(parsed.kind).toBe("status_change");
    if (parsed.kind !== "status_change") return;
    expect(parsed.proposal.update.patch).toEqual({ status: "done" });
    expect(parsed.evidence).toEqual([
      { type: "pr", ref: "", repo: "", actor: "" },
    ]);
  });
});
