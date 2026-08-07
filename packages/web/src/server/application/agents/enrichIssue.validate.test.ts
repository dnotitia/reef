import { describe, expect, it } from "vitest";
import { validateSuggestions } from "./enrichIssue";
import { baseContext } from "./enrichIssue.testSupport";

describe("validateSuggestions", () => {
  it("keeps valid suggestions and drops malformed ones", () => {
    const out = validateSuggestions(
      [
        {
          field: "priority",
          value: "high",
          reasoning: "Important.",
          confidence: 0.9,
        },
        {
          field: "priority",
          value: "urgent",
          reasoning: "x",
          confidence: 0.5,
        }, // invalid enum
        { totally: "wrong" },
      ],
      { context: baseContext },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.field).toBe("priority");
  });

  it("dedupes by field — first valid suggestion wins", () => {
    const out = validateSuggestions(
      [
        {
          field: "labels",
          value: ["one"],
          reasoning: "r1",
          confidence: 0.9,
        },
        {
          field: "labels",
          value: ["two"],
          reasoning: "r2",
          confidence: 0.9,
        },
      ],
      { context: baseContext },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.field).toBe("labels");
    if (out[0]?.field === "labels") {
      expect(out[0].value).toEqual(["one"]);
    }
  });

  it("filters depends_on to ids that exist in context", () => {
    const out = validateSuggestions(
      [
        {
          field: "depends_on",
          value: ["REEF-002", "REEF-999"],
          reasoning: "Real + fake.",
          confidence: 0.8,
        },
      ],
      { context: baseContext },
    );
    expect(out).toHaveLength(1);
    if (out[0]?.field === "depends_on") {
      expect(out[0].value).toEqual(["REEF-002"]);
    }
  });

  it("drops depends_on entirely when no ids match", () => {
    const out = validateSuggestions(
      [
        {
          field: "depends_on",
          value: ["REEF-999"],
          reasoning: "Hallucinated.",
          confidence: 0.8,
        },
      ],
      { context: baseContext },
    );
    expect(out).toHaveLength(0);
  });

  it("filters blocks to ids that exist in context", () => {
    const out = validateSuggestions(
      [
        {
          field: "blocks",
          value: ["REEF-002", "REEF-999"],
          reasoning: "Real + fake.",
          confidence: 0.8,
        },
      ],
      { context: baseContext },
    );
    expect(out).toHaveLength(1);
    if (out[0]?.field === "blocks") {
      expect(out[0].value).toEqual(["REEF-002"]);
    }
  });

  it("grounds parent_id and related_to against known issues", () => {
    const out = validateSuggestions(
      [
        {
          field: "parent_id",
          value: "REEF-002",
          reasoning: "Matches the parent story.",
          confidence: 0.8,
        },
        {
          field: "related_to",
          value: ["REEF-002", "REEF-999"],
          reasoning: "Only one relation is present in context.",
          confidence: 0.8,
        },
        {
          field: "parent_id",
          value: "REEF-999",
          reasoning: "Hallucinated duplicate parent.",
          confidence: 0.8,
        },
      ],
      { context: baseContext },
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ field: "parent_id", value: "REEF-002" });
    if (out[1]?.field === "related_to") {
      expect(out[1].value).toEqual(["REEF-002"]);
    }
  });

  it("drops start_date and due_date suggestions that are not valid dates", () => {
    const out = validateSuggestions(
      [
        {
          field: "start_date",
          value: "tomorrow",
          reasoning: "Inferred without an explicit date.",
          confidence: 0.7,
        },
        {
          field: "due_date",
          value: "next week",
          reasoning: "Inferred without an explicit date.",
          confidence: 0.7,
        },
      ],
      { context: baseContext },
    );
    expect(out).toHaveLength(0);
  });

  it("normalizes labels without requiring a whitelist", () => {
    const out = validateSuggestions(
      [
        {
          field: "labels",
          value: [" bug ", "totally-made-up-label", "bug", "enhancement"],
          reasoning: "Mix of existing and new labels.",
          confidence: 0.9,
        },
      ],
      { context: baseContext },
    );
    expect(out).toHaveLength(1);
    if (out[0]?.field === "labels") {
      expect(out[0].value).toEqual([
        "bug",
        "totally-made-up-label",
        "enhancement",
      ]);
    }
  });

  it("drops the labels suggestion entirely when all labels are blank", () => {
    const out = validateSuggestions(
      [
        {
          field: "labels",
          value: [" ", ""],
          reasoning: "No usable labels.",
          confidence: 0.9,
        },
      ],
      { context: baseContext },
    );
    expect(out).toHaveLength(0);
  });

  it("caps label suggestions to five entries", () => {
    const out = validateSuggestions(
      [
        {
          field: "labels",
          value: ["one", "two", "three", "four", "five", "six"],
          reasoning: "Many useful labels.",
          confidence: 0.9,
        },
      ],
      { context: baseContext },
    );
    expect(out).toHaveLength(1);
    if (out[0]?.field === "labels") {
      expect(out[0].value).toEqual(["one", "two", "three", "four", "five"]);
    }
  });

  it("filters planning IDs to those in the planning catalog", () => {
    const out = validateSuggestions(
      [
        {
          field: "sprint_id",
          value: "11111111-1111-4111-8111-111111111111",
          reasoning: "Sprint is explicitly named.",
          confidence: 0.8,
        },
        {
          field: "milestone_id",
          value: "99999999-9999-4999-8999-999999999999",
          reasoning: "Hallucinated milestone.",
          confidence: 0.8,
        },
        {
          field: "release_id",
          value: "33333333-3333-4333-8333-333333333333",
          reasoning: "Release is explicitly named.",
          confidence: 0.8,
        },
      ],
      {
        context: {
          ...baseContext,
          planningCatalog: {
            sprints: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                name: "Sprint 12",
                status: "active",
                start_date: "2026-04-01",
                end_date: "2026-04-14",
                goal: "",
              },
            ],
            milestones: [],
            releases: [
              {
                id: "33333333-3333-4333-8333-333333333333",
                name: "April",
                status: "planned",
                target_date: "2026-04-30",
                notes: "",
              },
            ],
          },
        },
      },
    );
    expect(out.map((s) => s.field)).toEqual(["sprint_id", "release_id"]);
  });

  it("drops planning suggestions when planning catalog is unavailable", () => {
    const out = validateSuggestions(
      [
        {
          field: "sprint_id",
          value: "11111111-1111-4111-8111-111111111111",
          reasoning: "No catalog.",
          confidence: 0.8,
        },
      ],
      { context: baseContext },
    );
    expect(out).toHaveLength(0);
  });
});
