import { describe, expect, it } from "vitest";
import {
  buildJiraFieldCatalog,
  resolveJiraField,
  resolveJiraFields,
} from "./fieldCatalog.js";

const snapshot = buildJiraFieldCatalog({
  retrievedAt: "2026-07-20T05:00:00.000Z",
  fields: [
    {
      id: "customfield_10001",
      name: "Iteration",
      custom: true,
      clauseNames: ["cf[10001]"],
      schema: {
        type: "array",
        items: "json",
        custom: "com.pyxis.greenhopper.jira:gh-sprint",
      },
    },
    {
      id: "customfield_10002",
      name: "Story points",
      custom: true,
      schema: {
        type: "number",
        custom: "com.atlassian.jira.plugin.system.customfieldtypes:float",
      },
    },
    {
      id: "customfield_10003",
      name: "Start_Date",
      custom: true,
      schema: { type: "date", custom: "tenant:start-date" },
    },
    {
      id: "customfield_10004",
      name: "Ordering",
      custom: true,
      schema: {
        type: "string",
        custom: "com.pyxis.greenhopper.jira:gh-lexo-rank",
      },
    },
  ],
});

describe("Jira tenant field catalog", () => {
  it("uses the same offset-datetime contract as serialized import plans", () => {
    expect(() =>
      buildJiraFieldCatalog({ retrievedAt: "2026-07-20", fields: [] }),
    ).toThrow("invalid Jira field catalog retrieval timestamp");
  });

  it("resolves project-varying ids by override, exact schema key, then normalized exact alias", () => {
    const resolved = resolveJiraFields(snapshot, {
      sprint: "customfield_10001",
    });
    expect(resolved.sprint).toMatchObject({
      classification: "resolved",
      reason: "explicit_override",
      field: { id: "customfield_10001" },
    });
    expect(resolved.story_points).toMatchObject({
      classification: "resolved",
      reason: "exact_schema_custom_key",
      field: { id: "customfield_10002" },
    });
    expect(resolved.start_date).toMatchObject({
      classification: "resolved",
      reason: "normalized_exact_alias",
      field: { id: "customfield_10003" },
    });
    expect(resolved.rank.field?.id).toBe("customfield_10004");
  });

  it("fails closed for absent overrides, ambiguity, and fuzzy substrings", () => {
    expect(
      resolveJiraField(snapshot, "sprint", { sprint: "customfield_99999" }),
    ).toMatchObject({ classification: "field_override_invalid", field: null });

    const ambiguous = buildJiraFieldCatalog({
      retrievedAt: "2026-07-20T05:00:00.000Z",
      fields: [
        {
          id: "a",
          name: "Sprint",
          schema: {
            type: "array",
            items: "json",
            custom: "com.pyxis.greenhopper.jira:gh-sprint",
          },
        },
        {
          id: "b",
          name: "Iteration",
          schema: {
            type: "array",
            items: "json",
            custom: "com.pyxis.greenhopper.jira:gh-sprint",
          },
        },
      ],
    });
    expect(resolveJiraField(ambiguous, "sprint")).toMatchObject({
      classification: "field_ambiguous",
      candidateIds: ["a", "b"],
    });

    const fuzzy = buildJiraFieldCatalog({
      retrievedAt: "2026-07-20T05:00:00.000Z",
      fields: [
        { id: "x", name: "Old Sprint backup", schema: { type: "array" } },
      ],
    });
    expect(resolveJiraField(fuzzy, "sprint")).toMatchObject({
      classification: "field_unresolved",
      candidateIds: [],
    });
  });
});
