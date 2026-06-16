import { describe, expect, it } from "vitest";
import type { EnrichmentUserPromptRequest } from "../../schemas/ai/prompts";
import {
  buildEnrichmentSystemPrompt,
  buildEnrichmentUserPrompt,
} from "./enrichment";

describe("buildEnrichmentSystemPrompt", () => {
  it("contains the suggestions schema field", () => {
    const prompt = buildEnrichmentSystemPrompt();
    expect(prompt).toContain("suggestions");
  });

  it("contains all valid field names", () => {
    const prompt = buildEnrichmentSystemPrompt();
    expect(prompt).toContain("priority");
    expect(prompt).toContain("assigned_to");
    expect(prompt).toContain("labels");
    expect(prompt).toContain("depends_on");
    expect(prompt).toContain("blocks");
    expect(prompt).toContain("title");
    expect(prompt).toContain("content");
    expect(prompt).toContain("external_refs");
  });

  it("describes external_refs value shape", () => {
    const prompt = buildEnrichmentSystemPrompt();
    expect(prompt).toContain('"type": "github_issue"');
    expect(prompt).toContain("Each object must include ref or an http(s) url");
    expect(prompt).toContain('"field": "external_refs"');
  });

  it("contains confidence and reasoning fields", () => {
    const prompt = buildEnrichmentSystemPrompt();
    expect(prompt).toContain("confidence");
    expect(prompt).toContain("reasoning");
  });

  it("contains 0.5 confidence threshold rule", () => {
    const prompt = buildEnrichmentSystemPrompt();
    expect(prompt).toContain("0.5");
  });

  it("contains EXAMPLE RESPONSE", () => {
    const prompt = buildEnrichmentSystemPrompt();
    expect(prompt).toContain("EXAMPLE");
  });

  it("instructs LLM to use tools before generating suggestions", () => {
    const prompt = buildEnrichmentSystemPrompt();
    expect(prompt).toContain("Call tools BEFORE emitting the final JSON");
    expect(prompt).toContain("list_assignees");
  });

  it("documents GitHub grounding tools as server-bound to the monitored repo", () => {
    const prompt = buildEnrichmentSystemPrompt();
    expect(prompt).toContain('search_code({ "query": "..."');
    expect(prompt).toContain('dev_read_file({ "path": "..."');
    expect(prompt).toContain("server-selected monitored");
    expect(prompt).not.toContain('search_code({ "owner":');
    expect(prompt).not.toContain('dev_read_file({ "owner":');
  });

  it("includes current date and timezone context for date suggestions", () => {
    const prompt = buildEnrichmentSystemPrompt();
    expect(prompt).toMatch(/Today is \d{4}-\d{2}-\d{2}/);
    expect(prompt).toContain("Timezone:");
  });

  it("allows new labels while grounding label suggestions in vault context", () => {
    const prompt = buildEnrichmentSystemPrompt();
    expect(prompt).toContain("Vault Label Context");
    expect(prompt).toContain("new short lowercase kebab-case labels");
  });
});

describe("buildEnrichmentUserPrompt", () => {
  const baseRequest: EnrichmentUserPromptRequest = {
    issueId: "REEF-042",
    draft: {
      fields: {
        title: "Login issue",
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
      content: "Users cannot log in sometimes.",
    },
    context: {
      labels: [],
      members: [],
      templates: [],
      knownIssueIds: [],
    },
    repoContext: {
      owner: "octo",
      repo: "cat",
    },
  };

  it("contains the issue ID", () => {
    const prompt = buildEnrichmentUserPrompt(baseRequest);
    expect(prompt).toContain("REEF-042");
  });

  it("contains the issue title", () => {
    const prompt = buildEnrichmentUserPrompt(baseRequest);
    expect(prompt).toContain("Login issue");
  });

  it("contains the issue content", () => {
    const prompt = buildEnrichmentUserPrompt(baseRequest);
    expect(prompt).toContain("Users cannot log in sometimes.");
  });

  it("shows no-context messages when context lists are empty", () => {
    const prompt = buildEnrichmentUserPrompt(baseRequest);
    expect(prompt).toContain("(none)");
  });

  it("includes vault label, current people, template, and planning context lines", () => {
    const prompt = buildEnrichmentUserPrompt({
      ...baseRequest,
      draft: {
        ...baseRequest.draft,
        fields: {
          ...baseRequest.draft.fields,
          assigned_to: "minsu",
        },
      },
      context: {
        labels: [{ name: "auth", issue_count: 2, template_count: 1 }],
        members: [{ login: "minsu", name: "Minsu", avatar_url: null }],
        templates: [
          {
            name: "bug",
            label: "Bug",
            description: "Broken behavior",
            priority: "high",
            default_labels: ["bug"],
          },
        ],
        knownIssueIds: ["REEF-001"],
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
          releases: [],
        },
      },
    });
    expect(prompt).toContain("auth | issues:2 | templates:1");
    expect(prompt).toContain("assigned_to:minsu");
    expect(prompt).not.toContain("minsu | Minsu");
    expect(prompt).toContain("name:bug");
    expect(prompt).toContain("11111111-1111-4111-8111-111111111111");
  });

  it("ends with JSON instruction", () => {
    const prompt = buildEnrichmentUserPrompt(baseRequest);
    expect(prompt).toContain("Return only the JSON object.");
  });
});
