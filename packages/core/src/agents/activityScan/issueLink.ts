import { SpanStatusCode, trace } from "@opentelemetry/api";
import { stepCountIs } from "ai";
import type { AkbAdapter } from "../../adapters/akb";
import { readIssue } from "../../adapters/akb";
import type { LlmAdapter } from "../../adapters/llm";
import {
  type ActivityIssueLinkDecision,
  ActivityIssueLinkDecisionSchema,
} from "../../schemas/ai/prompts";
import { getAgentRegistryEntry } from "../framework/registry";
import { buildActivityIssueLinkUserPrompt } from "../prompts/activityIssueLink";
import { createWorkspaceReadToolset } from "../tools/toolsets";
import { collectGroundedIssueRefs, normalizeIssueRef } from "./issueRefs";
import { type ScanActivityEventSink, runActivityAgentTask } from "./taskRunner";
import { MAX_LINK_STEPS, type NormalisedActivity } from "./types";

const tracer = trace.getTracer("@reef/core");

interface GenerateIssueLinkForActivityParams {
  activity: NormalisedActivity;
  akbAdapter: AkbAdapter;
  vault: string;
  llmAdapter: LlmAdapter;
  systemPrompt: string;
  projectPrefix: string;
  onEvent?: ScanActivityEventSink;
}

export async function generateIssueLinkForActivity(
  params: GenerateIssueLinkForActivityParams,
): Promise<ActivityIssueLinkDecision | null> {
  return runActivityAgentTask({
    taskId: "activity.issue-link",
    execute: () => generateIssueLinkForActivityInner(params),
    onEvent: params.onEvent,
  });
}

async function generateIssueLinkForActivityInner(
  params: GenerateIssueLinkForActivityParams,
): Promise<ActivityIssueLinkDecision | null> {
  const {
    activity,
    akbAdapter,
    vault,
    llmAdapter,
    systemPrompt,
    projectPrefix,
  } = params;

  return tracer.startActiveSpan(
    "reef.agent.scanActivity.linkIssue",
    async (span) => {
      span.setAttribute("activity.type", activity.type);
      span.setAttribute("activity.ref", activity.ref);
      try {
        const userPrompt = buildActivityIssueLinkUserPrompt({
          activity: activity.draftPromptRequest.activity,
          projectPrefix,
        });
        const tools = createWorkspaceReadToolset({
          adapter: akbAdapter,
          vault,
          includeAssignees: false,
        });
        const result = await llmAdapter.generateText({
          model: llmAdapter.model(),
          system: systemPrompt,
          prompt: userPrompt,
          tools,
          stopWhen: stepCountIs(MAX_LINK_STEPS),
          experimental_telemetry: {
            isEnabled: true,
            functionId: getAgentRegistryEntry("activity.issue-link").functionId,
          },
        });
        const { text } = result;
        const groundedIssueRefs = collectGroundedIssueRefs(
          result,
          projectPrefix,
        );

        const trimmed = text.trim();
        if (trimmed === "null" || trimmed === "") {
          span.setAttribute("llm.null_response", true);
          span.setStatus({ code: SpanStatusCode.OK });
          return null;
        }

        let raw: unknown;
        try {
          raw = JSON.parse(trimmed);
        } catch {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Failed to parse issue-link JSON response",
          });
          return null;
        }

        const parsed = ActivityIssueLinkDecisionSchema.safeParse(raw);
        if (!parsed.success) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Issue-link response failed schema validation",
          });
          return null;
        }
        span.setAttribute("semantic_link.decision", parsed.data.decision);
        span.setAttribute("semantic_link.confidence", parsed.data.confidence);
        if (parsed.data.issue_id) {
          span.setAttribute("semantic_link.issue_id", parsed.data.issue_id);
        }
        const linkedIssueRef = parsed.data.issue_id
          ? normalizeIssueRef(parsed.data.issue_id, projectPrefix)
          : null;
        if (
          parsed.data.decision === "linked" &&
          (!linkedIssueRef || !groundedIssueRefs.has(linkedIssueRef))
        ) {
          span.setAttribute("semantic_link.ungrounded", true);
          span.setStatus({ code: SpanStatusCode.OK });
          return null;
        }
        span.setStatus({ code: SpanStatusCode.OK });
        return parsed.data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        return null;
      } finally {
        span.end();
      }
    },
  );
}

export async function ensureLinkedIssueExists({
  akbAdapter,
  vault,
  linkedIssueRef,
}: {
  akbAdapter: AkbAdapter;
  vault: string;
  linkedIssueRef: string;
}): Promise<boolean> {
  try {
    await readIssue({
      adapter: akbAdapter,
      vault,
      id: linkedIssueRef,
    });
    return true;
  } catch {
    return false;
  }
}
