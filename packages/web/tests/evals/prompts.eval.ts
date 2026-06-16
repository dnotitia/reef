/**
 * LLM Eval harness for reef prompt builders.
 *
 * Status: canned-task suite only. Real-LLM execution is NOT yet wired up —
 * `cannedTask` returns the fixture response regardless of `REEF_EVAL_RUN`.
 * The `REEF_EVAL_RUN=1` flag and the `OPENAI_API_KEY` env plumbed in CI are
 * placeholders for follow-up work that swaps `cannedTask` for an
 * AI-SDK-backed `task` (e.g., `generateText` against
 * `process.env.OPENAI_API_KEY`). Until then the suite acts as a deterministic
 * scaffold that exercises prompt builders, fixture shapes, and scorers.
 *
 * `describe.concurrent` is mandatory for LLM evals because LLM calls are slow.
 *
 * Uses vitest-evals@0.1.x API: describeEval with expected:string and ScoreFn.
 */
import { describe } from "vitest";
import { type ScoreFn, describeEval } from "vitest-evals";

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
} from "@reef/core";

import autoIssueCanned from "./fixtures/auto-issue-canned.json";
import draftIssueCanned from "./fixtures/draft-issue-canned.json";
import enrichmentCanned from "./fixtures/enrichment-canned.json";
import projectStateCanned from "./fixtures/project-state-canned.json";
import projectStateCodeQuestionCanned from "./fixtures/project-state-code-question-canned.json";
import statusRationaleCanned from "./fixtures/status-rationale-canned.json";
import statusRationaleV2Canned from "./fixtures/status-rationale-v2-canned.json";

/**
 * Guard: skip the gated prompt-eval scenarios unless explicitly enabled.
 * The scenarios still use canned responses; `REEF_EVAL_RUN=1` is only a
 * switch for exercising the deterministic eval scaffold in protected jobs.
 */
const skipInCI = () => process.env.REEF_EVAL_RUN !== "1";

/**
 * Canned task runner for deterministic CI testing.
 * Returns the canned JSON response string from the fixture.
 */
function cannedTask(
  cannedResponse: Record<string, unknown>,
): (input: string) => Promise<string> {
  return async (_input: string) => JSON.stringify(cannedResponse);
}

/**
 * Scorer that checks whether the output is valid JSON containing all expected fields.
 */
const jsonFieldsScorer: ScoreFn = ({
  output,
  expected,
}: {
  input: string;
  output: string;
  expected?: string;
}) => {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const expectedFields = expected ? (JSON.parse(expected) as string[]) : [];
    const hasAllFields = expectedFields.every((field) => field in parsed);
    return { score: hasAllFields ? 1 : 0 };
  } catch {
    return { score: 0 };
  }
};

/**
 * Factory that returns a scorer computing the ratio of keywords found in the
 * output JSON (case-insensitive match across the full stringified output).
 * Score = hits / keywords.length; returns 0 if the list is empty or JSON is invalid.
 */
const makeKeywordsScorer =
  (keywords: string[]): ScoreFn =>
  ({ output }) => {
    try {
      const outputStr = JSON.stringify(
        JSON.parse(output) as unknown,
      ).toLowerCase();
      const hits = keywords.filter((k) =>
        outputStr.includes(k.toLowerCase()),
      ).length;
      return { score: keywords.length > 0 ? hits / keywords.length : 0 };
    } catch {
      return { score: 0 };
    }
  };

/**
 * Factory that returns a scorer checking that a named string field in the output
 * JSON has length >= minLen. Closes over `field` and `minLen` so the scorer does
 * not need to share `expected` with `jsonFieldsScorer` in the same scenario.
 */
const makeFieldLengthScorer =
  (field: string, minLen: number): ScoreFn =>
  ({ output }) => {
    try {
      const parsed = JSON.parse(output) as Record<string, unknown>;
      const value =
        typeof parsed[field] === "string" ? (parsed[field] as string) : "";
      return { score: value.length >= minLen ? 1 : 0 };
    } catch {
      return { score: 0 };
    }
  };

describe.concurrent("Prompt Eval Suite", () => {
  // ── Enrichment ──────────────────────────────────────────────────────────────

  describeEval("enrichment-system-prompt", {
    skipIf: skipInCI,
    data: async () => [
      {
        input: `${buildEnrichmentSystemPrompt()}\n\n${buildEnrichmentUserPrompt(
          EnrichmentUserPromptRequestSchema.parse(enrichmentCanned.input),
        )}`,
        expected: JSON.stringify(enrichmentCanned.expectedFields),
      },
    ],
    task: cannedTask(
      enrichmentCanned.cannedResponse as Record<string, unknown>,
    ),
    scorers: [jsonFieldsScorer],
    threshold: 1.0,
  });

  // ── Auto-issue generation ────────────────────────────────────────────────────

  describeEval("auto-issue-system-prompt", {
    skipIf: skipInCI,
    data: async () => [
      {
        input: `${buildAutoIssueSystemPrompt(autoIssueCanned.input.projectPrefix)}\n\n${buildAutoIssueUserPrompt(
          {
            activity: autoIssueCanned.input.activity,
          },
        )}`,
        expected: JSON.stringify(autoIssueCanned.expectedFields),
      },
    ],
    task: cannedTask(autoIssueCanned.cannedResponse as Record<string, unknown>),
    scorers: [jsonFieldsScorer],
    threshold: 1.0,
  });

  // ── Status-change rationale ──────────────────────────────────────────────────

  describeEval("status-rationale-system-prompt", {
    skipIf: skipInCI,
    data: async () => [
      {
        input: `${buildStatusRationaleSystemPrompt()}\n\n${buildStatusRationaleUserPrompt(statusRationaleCanned.input)}`,
        expected: JSON.stringify(statusRationaleCanned.expectedFields),
      },
    ],
    task: cannedTask(
      statusRationaleCanned.cannedResponse as Record<string, unknown>,
    ),
    scorers: [jsonFieldsScorer],
    threshold: 1.0,
  });

  // ── Project state Q&A ────────────────────────────────────────────────────────

  describeEval("project-state-system-prompt", {
    skipIf: skipInCI,
    data: async () => {
      const req = ProjectStateUserPromptRequestSchema.parse(
        projectStateCanned.input,
      );
      return [
        {
          input: `${buildProjectStateSystemPrompt({ hasLocalTools: false, hasDevTools: false, monitoredRepos: [] })}\n\n${buildProjectStateUserPrompt(req)}`,
          expected: JSON.stringify(projectStateCanned.expectedFields),
        },
      ];
    },
    task: cannedTask(
      projectStateCanned.cannedResponse as Record<string, unknown>,
    ),
    scorers: [jsonFieldsScorer],
    threshold: 1.0,
  });

  // ── Draft issue from description ─────────────────────────────────────────────

  describeEval("draft-issue-from-description", {
    skipIf: skipInCI,
    data: async () => {
      // Validate fixture input shape against the Zod schema so a malformed
      // fixture fails fast instead of silently producing a misleading prompt.
      const draftReq = EnrichmentUserPromptRequestSchema.parse({
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
      return [
        {
          input: `${buildEnrichmentSystemPrompt()}\n\n${buildEnrichmentUserPrompt(draftReq)}`,
          expected: JSON.stringify(draftIssueCanned.expectedFields),
        },
      ];
    },
    task: cannedTask(
      draftIssueCanned.cannedResponse as Record<string, unknown>,
    ),
    scorers: [
      jsonFieldsScorer,
      makeKeywordsScorer(draftIssueCanned.expectedKeywords),
    ],
    threshold: 0.9,
  });

  // ── Status-change rationale from PR (v2) ─────────────────────────────────────

  describeEval("status-rationale-from-pr", {
    skipIf: skipInCI,
    data: async () => {
      const req = StatusRationaleUserPromptRequestSchema.parse(
        statusRationaleV2Canned.input,
      );
      return [
        {
          input: `${buildStatusRationaleSystemPrompt()}\n\n${buildStatusRationaleUserPrompt(req)}`,
          expected: JSON.stringify(statusRationaleV2Canned.expectedFields),
        },
      ];
    },
    task: cannedTask(
      statusRationaleV2Canned.cannedResponse as Record<string, unknown>,
    ),
    scorers: [
      jsonFieldsScorer,
      makeFieldLengthScorer(
        "rationale",
        statusRationaleV2Canned.minRationaleLength,
      ),
    ],
    threshold: 0.9,
  });

  // ── Project state code question ──────────────────────────────────────────────

  describeEval("project-state-code-question", {
    skipIf: skipInCI,
    data: async () => {
      const req = ProjectStateUserPromptRequestSchema.parse(
        projectStateCodeQuestionCanned.input,
      );
      return [
        {
          input: `${buildProjectStateSystemPrompt({ hasLocalTools: false, hasDevTools: true, monitoredRepos: [] })}\n\n${buildProjectStateUserPrompt(req)}`,
          expected: JSON.stringify(
            projectStateCodeQuestionCanned.expectedFields,
          ),
        },
      ];
    },
    task: cannedTask(
      projectStateCodeQuestionCanned.cannedResponse as Record<string, unknown>,
    ),
    scorers: [
      jsonFieldsScorer,
      makeKeywordsScorer(projectStateCodeQuestionCanned.expectedKeywords),
    ],
    threshold: 0.9,
  });
});

// System prompt smoke-tests: always run, test builders not LLM
describe.concurrent("Prompt Builder Smoke Tests", () => {
  describeEval("enrichment-system-prompt-smoke", {
    skipIf: () => false,
    data: async () => [
      {
        input: buildEnrichmentSystemPrompt(),
        expected: "non-empty",
      },
    ],
    task: async (input: string) => (input.length > 0 ? "non-empty" : "empty"),
    scorers: [
      ({ output, expected }) => ({
        score: output === expected ? 1 : 0,
      }),
    ],
    threshold: 1.0,
  });

  describeEval("auto-issue-system-prompt-smoke", {
    skipIf: () => false,
    data: async () => [
      {
        input: buildAutoIssueSystemPrompt("REEF"),
        expected: "non-empty",
      },
    ],
    task: async (input: string) => (input.length > 0 ? "non-empty" : "empty"),
    scorers: [
      ({ output, expected }) => ({
        score: output === expected ? 1 : 0,
      }),
    ],
    threshold: 1.0,
  });

  describeEval("status-rationale-system-prompt-smoke", {
    skipIf: () => false,
    data: async () => [
      {
        input: buildStatusRationaleSystemPrompt(),
        expected: "non-empty",
      },
    ],
    task: async (input: string) => (input.length > 0 ? "non-empty" : "empty"),
    scorers: [
      ({ output, expected }) => ({
        score: output === expected ? 1 : 0,
      }),
    ],
    threshold: 1.0,
  });

  describeEval("project-state-system-prompt-smoke", {
    skipIf: () => false,
    data: async () => [
      {
        input: buildProjectStateSystemPrompt({
          hasLocalTools: false,
          hasDevTools: false,
          monitoredRepos: [],
        }),
        expected: "non-empty",
      },
    ],
    task: async (input: string) => (input.length > 0 ? "non-empty" : "empty"),
    scorers: [
      ({ output, expected }) => ({
        score: output === expected ? 1 : 0,
      }),
    ],
    threshold: 1.0,
  });
});
