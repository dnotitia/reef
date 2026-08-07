/**
 * Deterministic canned-task checks for reef prompt builders.
 *
 * Real-LLM execution stays outside this hermetic command and can be added as
 * a separate live boundary later. Each case has a short stable id so test
 * output does not expand to include the generated prompt.
 */
import { describe, expect, it } from "vitest";

import {
  EnrichmentUserPromptRequestSchema,
  ProjectStateUserPromptRequestSchema,
  StatusRationaleUserPromptRequestSchema,
  buildAutoIssueSystemPrompt,
  buildAutoIssueUserPrompt,
  buildEnrichmentSystemPrompt,
  buildEnrichmentUserPrompt,
  buildProjectStateSystemPrompt,
  buildProjectStateUserPrompt,
  buildStatusRationaleSystemPrompt,
  buildStatusRationaleUserPrompt,
  buildWorkspaceChatSystemPrompt,
} from "@/server/application/agents/prompts";

import autoIssueCanned from "./fixtures/auto-issue-canned.json";
import draftIssueCanned from "./fixtures/draft-issue-canned.json";
import enrichmentCanned from "./fixtures/enrichment-canned.json";
import projectStateCanned from "./fixtures/project-state-canned.json";
import projectStateCodeQuestionCanned from "./fixtures/project-state-code-question-canned.json";
import statusRationaleCanned from "./fixtures/status-rationale-canned.json";
import statusRationaleV2Canned from "./fixtures/status-rationale-v2-canned.json";

/** Return the fixture response without making any network or model call. */
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
  for (const field of fields) {
    expect(output).toHaveProperty(field);
  }
}

function keywordScore(output: Record<string, unknown>, keywords: string[]) {
  const outputText = JSON.stringify(output).toLowerCase();
  const hits = keywords.filter((keyword) =>
    outputText.includes(keyword.toLowerCase()),
  ).length;
  return keywords.length > 0 ? hits / keywords.length : 0;
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

  it("auto_issue", async () => {
    const input = `${buildAutoIssueSystemPrompt(autoIssueCanned.input.projectPrefix)}\n\n${buildAutoIssueUserPrompt(
      { activity: autoIssueCanned.input.activity },
    )}`;
    const output = await runCannedJsonCase(
      input,
      autoIssueCanned.cannedResponse as Record<string, unknown>,
    );
    expectFields(output, autoIssueCanned.expectedFields);
  });

  it("status_rationale", async () => {
    const input = `${buildStatusRationaleSystemPrompt()}\n\n${buildStatusRationaleUserPrompt(statusRationaleCanned.input)}`;
    const output = await runCannedJsonCase(
      input,
      statusRationaleCanned.cannedResponse as Record<string, unknown>,
    );
    expectFields(output, statusRationaleCanned.expectedFields);
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

  it("draft_issue", async () => {
    // Validate fixture input shape so malformed data fails before scoring.
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
    expect(
      keywordScore(output, draftIssueCanned.expectedKeywords),
    ).toBeGreaterThanOrEqual(0.9);
  });

  it("status_rationale_pr", async () => {
    const request = StatusRationaleUserPromptRequestSchema.parse(
      statusRationaleV2Canned.input,
    );
    const input = `${buildStatusRationaleSystemPrompt()}\n\n${buildStatusRationaleUserPrompt(request)}`;
    const output = await runCannedJsonCase(
      input,
      statusRationaleV2Canned.cannedResponse as Record<string, unknown>,
    );
    expectFields(output, statusRationaleV2Canned.expectedFields);
    expect(output.rationale).toBeTypeOf("string");
    expect((output.rationale as string).length).toBeGreaterThanOrEqual(
      statusRationaleV2Canned.minRationaleLength,
    );
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
    expect(
      keywordScore(output, projectStateCodeQuestionCanned.expectedKeywords),
    ).toBeGreaterThanOrEqual(0.9);
  });
});

describe("prompt-smoke", () => {
  it("enrichment_smoke", () => {
    expect(buildEnrichmentSystemPrompt()).not.toHaveLength(0);
  });

  it("auto_issue_smoke", () => {
    expect(buildAutoIssueSystemPrompt("REEF")).not.toHaveLength(0);
  });

  it("status_rationale_smoke", () => {
    expect(buildStatusRationaleSystemPrompt()).not.toHaveLength(0);
  });

  it("project_state_smoke", () => {
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
    const grounded =
      prompt.includes("reef-e2e") &&
      prompt.includes("Sprint 6") &&
      prompt.includes("REEF-360") &&
      prompt.includes("Ground the chat on this issue.");
    const markdownMode =
      prompt.includes("Markdown") && !prompt.includes("referenced_issue_ids");
    expect(grounded && markdownMode).toBe(true);
  });
});
