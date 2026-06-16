import { describe, expect, it } from "vitest";
import { buildReefVaultSkillDocuments } from "../adapters/akb/vaultSkill/documents";
import { EnrichmentFieldEnum } from "../schemas/ai/enrichment";
import {
  ExternalRefTypeEnum,
  IssueCreateFieldsSchema,
} from "../schemas/issues/metadata";
import { AUTO_ISSUE_LLM_RESPONSE_FIELDS } from "./activityScan/types";
import {
  buildAutoIssueSystemPrompt,
  buildEnrichmentSystemPrompt,
} from "./prompts";

function quotedList(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}

function quotedUnion(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(" | ");
}

function englishList(values: readonly string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

describe("issue field drift guards", () => {
  it("keeps enrichment prompt field lists aligned with enrichment schemas", () => {
    const prompt = buildEnrichmentSystemPrompt();

    expect(prompt).toContain(
      `"field" must be one of: ${quotedList(EnrichmentFieldEnum.options)}`,
    );
    expect(prompt).toContain(
      `"external_refs" value must be an array of objects: { "type": ${quotedUnion(
        ExternalRefTypeEnum.options,
      )}`,
    );
  });

  it("keeps auto-issue draft response fields inside create-field schema", () => {
    const createFields = new Set(Object.keys(IssueCreateFieldsSchema.shape));

    expect(
      AUTO_ISSUE_LLM_RESPONSE_FIELDS.filter(
        (field) => !createFields.has(field),
      ),
    ).toEqual([]);
    expect(buildAutoIssueSystemPrompt("REEF")).toContain(
      `Allowed issue field keys in this response are: ${quotedList(
        AUTO_ISSUE_LLM_RESPONSE_FIELDS,
      )}.`,
    );
  });

  it("keeps vault-skill external reference guidance aligned with schema", () => {
    const content = buildReefVaultSkillDocuments("reef")
      .map((doc) => doc.content)
      .join("\n");
    const externalRefTypes = englishList(ExternalRefTypeEnum.options);

    expect(content).toContain(`Types are ${externalRefTypes}`);
    expect(content).not.toContain(
      "Types are github_issue, linear, slack, document, url, and other",
    );
    expect(content).toContain(
      "For akb documents, use first-class references relation edges, not external_refs.",
    );
  });
});
