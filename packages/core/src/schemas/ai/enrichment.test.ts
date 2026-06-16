import { describe, expect, it } from "vitest";
import {
  EnrichmentRequestSchema,
  EnrichmentResultSchema,
  EnrichmentSuggestionSchema,
} from "./enrichment";

describe("EnrichmentSuggestionSchema", () => {
  it("accepts a valid priority suggestion", () => {
    const result = EnrichmentSuggestionSchema.safeParse({
      field: "priority",
      value: "high",
      reasoning: "Affects auth flow used by all users.",
      confidence: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a priority suggestion with an invalid enum value", () => {
    const result = EnrichmentSuggestionSchema.safeParse({
      field: "priority",
      value: "urgent",
      reasoning: "Looks important.",
      confidence: 0.8,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a labels suggestion with a non-empty array", () => {
    const result = EnrichmentSuggestionSchema.safeParse({
      field: "labels",
      value: ["auth", "bug"],
      reasoning: "Describes a login failure.",
      confidence: 0.85,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a blocks suggestion with existing issue ids", () => {
    const result = EnrichmentSuggestionSchema.safeParse({
      field: "blocks",
      value: ["REEF-002"],
      reasoning: "This work should unblock REEF-002.",
      confidence: 0.8,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a labels suggestion with an empty array", () => {
    const result = EnrichmentSuggestionSchema.safeParse({
      field: "labels",
      value: [],
      reasoning: "n/a",
      confidence: 0.9,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a string value for labels (must be array)", () => {
    const result = EnrichmentSuggestionSchema.safeParse({
      field: "labels",
      value: "auth",
      reasoning: "n/a",
      confidence: 0.9,
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence outside [0, 1]", () => {
    const result = EnrichmentSuggestionSchema.safeParse({
      field: "title",
      value: "A new title",
      reasoning: "Better wording.",
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("EnrichmentResultSchema", () => {
  it("accepts an empty suggestions array", () => {
    expect(EnrichmentResultSchema.safeParse({ suggestions: [] }).success).toBe(
      true,
    );
  });

  it("accepts a mixed-field suggestion array", () => {
    const result = EnrichmentResultSchema.safeParse({
      suggestions: [
        {
          field: "priority",
          value: "medium",
          reasoning: "Moderate impact.",
          confidence: 0.7,
        },
        {
          field: "labels",
          value: ["docs"],
          reasoning: "Doc changes only.",
          confidence: 0.95,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("EnrichmentRequestSchema", () => {
  it("accepts the full new-issue draft and optional repo context", () => {
    const parsed = EnrichmentRequestSchema.parse({
      issueId: "REEF-001",
      vault: "reef-acme",
      draft: {
        fields: {
          title: "Fix login",
          issue_type: "bug",
          priority: null,
          assigned_to: null,
          requester: null,
          reporter: null,
          start_date: null,
          due_date: null,
          milestone_id: null,
          sprint_id: null,
          release_id: null,
          estimate_points: null,
          severity: null,
          parent_id: null,
          labels: [],
          depends_on: [],
          blocks: [],
          related_to: [],
          external_refs: [],
        },
        content: "",
      },
      repoContext: {
        owner: "octo",
        repo: "cat",
      },
    });
    expect(parsed.draft.content).toBe("");
    expect(parsed.repoContext).toEqual({ owner: "octo", repo: "cat" });
  });

  it("requires issueId, vault, and draft", () => {
    expect(EnrichmentRequestSchema.safeParse({}).success).toBe(false);
    expect(
      EnrichmentRequestSchema.safeParse({ issueId: "REEF-001" }).success,
    ).toBe(false);
    expect(
      EnrichmentRequestSchema.safeParse({
        issueId: "REEF-001",
        vault: "reef-acme",
      }).success,
    ).toBe(false);
  });

  it("rejects malformed vault ids", () => {
    expect(
      EnrichmentRequestSchema.safeParse({
        issueId: "REEF-001",
        vault: "reef/acme",
        draft: {
          fields: {
            title: "Fix login",
            issue_type: "bug",
            priority: null,
            assigned_to: null,
            requester: null,
            reporter: null,
            start_date: null,
            due_date: null,
            milestone_id: null,
            sprint_id: null,
            release_id: null,
            estimate_points: null,
            severity: null,
            parent_id: null,
            labels: [],
            depends_on: [],
            blocks: [],
            related_to: [],
            external_refs: [],
          },
          content: "",
        },
      }).success,
    ).toBe(false);
  });
});
