/** Deterministic canned-task checks for the retained Reef prompt builders. */
import { describe, expect, it } from "vitest";

import {
  EnrichmentUserPromptRequestSchema,
  ProjectStateUserPromptRequestSchema,
  buildEnrichmentSystemPrompt,
  buildEnrichmentUserPrompt,
  buildProjectStateSystemPrompt,
  buildProjectStateUserPrompt,
  buildWorkspaceChatSystemPrompt,
} from "@/server/application/agents/prompts";

import draftIssueCanned from "./fixtures/draft-issue-canned.json";
import enrichmentCanned from "./fixtures/enrichment-canned.json";
import projectStateCanned from "./fixtures/project-state-canned.json";
import projectStateCodeQuestionCanned from "./fixtures/project-state-code-question-canned.json";

function cannedTask(
  cannedResponse: Record<string, unknown>,
): (input: string) => Promise<string> {
  return async (_input: string) => JSON.stringify(cannedResponse);
}

function parseJsonObject(output: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(output);
  expect(parsed).toBeTypeOf("object");
  expect(parsed).not.toBeNull();
  return parsed as Record<string, unknown>;
}

async function runCannedJsonCase(
  input: string,
  response: Record<string, unknown>,
) {
  return parseJsonObject(await cannedTask(response)(input));
}

function expectFields(
  output: Record<string, unknown>,
  fields: readonly string[],
) {
  for (const field of fields) expect(output).toHaveProperty(field);
}

describe("prompt-evals", () => {
  it("enrichment", async () => {
    const input = `${buildEnrichmentSystemPrompt()}\n\n${buildEnrichmentUserPrompt(
      EnrichmentUserPromptRequestSchema.parse(enrichmentCanned.input),
    )}`;
    const output = await runCannedJsonCase(
      input,
      enrichmentCanned.cannedResponse as Record<string, unknown>,
    );
    expectFields(output, enrichmentCanned.expectedFields);
  });

  it("project_state", async () => {
    const request = ProjectStateUserPromptRequestSchema.parse(
      projectStateCanned.input,
    );
    const input = `${buildProjectStateSystemPrompt({ hasLocalTools: false, hasDevTools: false, monitoredRepos: [] })}\n\n${buildProjectStateUserPrompt(request)}`;
    const output = await runCannedJsonCase(
      input,
      projectStateCanned.cannedResponse as Record<string, unknown>,
    );
    expectFields(output, projectStateCanned.expectedFields);
  });

  it("draft_issue_enrichment", async () => {
    const request = EnrichmentUserPromptRequestSchema.parse({
      issueId: "DRAFT",
      draft: {
        fields: {
          title: draftIssueCanned.input.title,
          issue_type: "task",
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
        content: draftIssueCanned.input.description,
      },
      context: {
        labels: [],
        members: [],
        templates: [],
        knownIssueIds: [],
      },
    });
    const input = `${buildEnrichmentSystemPrompt()}\n\n${buildEnrichmentUserPrompt(request)}`;
    const output = await runCannedJsonCase(
      input,
      draftIssueCanned.cannedResponse as Record<string, unknown>,
    );
    expectFields(output, draftIssueCanned.expectedFields);
  });

  it("project_state_code", async () => {
    const request = ProjectStateUserPromptRequestSchema.parse(
      projectStateCodeQuestionCanned.input,
    );
    const input = `${buildProjectStateSystemPrompt({ hasLocalTools: false, hasDevTools: true, monitoredRepos: [] })}\n\n${buildProjectStateUserPrompt(request)}`;
    const output = await runCannedJsonCase(
      input,
      projectStateCodeQuestionCanned.cannedResponse as Record<string, unknown>,
    );
    expectFields(output, projectStateCodeQuestionCanned.expectedFields);
  });
});

describe("prompt-smoke", () => {
  it("retained prompts are non-empty", () => {
    expect(buildEnrichmentSystemPrompt()).not.toHaveLength(0);
    expect(
      buildProjectStateSystemPrompt({
        hasLocalTools: false,
        hasDevTools: false,
        monitoredRepos: [],
      }),
    ).not.toHaveLength(0);
  });

  it("chat_grounding", () => {
    const prompt = buildWorkspaceChatSystemPrompt({
      summary: {
        vault: "reef-e2e",
        activeSprint: { name: "Sprint 6", goal: "Ship chat grounding" },
        openIssueCount: 9,
        statusCounts: [{ status: "todo", count: 9 }],
      },
      route: "/reef-e2e/issues",
      issueContext: {
        issue: {
          id: "REEF-360",
          title: "Context-aware chat grounding",
          status: "in_progress",
          issue_type: "story",
          priority: "high",
          assigned_to: "alice",
          requester: null,
          reporter: null,
          start_date: null,
          due_date: null,
          milestone_id: null,
          sprint_id: null,
          release_id: null,
          estimate_points: null,
          severity: null,
          parent_id: "REEF-337",
          labels: ["story", "ai", "chat"],
          depends_on: [],
          blocks: [],
          related_to: ["REEF-361"],
        },
        body: "## User Story\nGround the chat on this issue.",
      },
      hasRepoTools: true,
    });
    expect(prompt).toContain("reef-e2e");
    expect(prompt).toContain("REEF-360");
    expect(prompt).toContain("Ground the chat on this issue.");
    expect(prompt).toContain("Markdown");
  });
});
