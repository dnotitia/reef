import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { AkbAdapter } from "../../adapters/akb";
import { readIssue } from "../../adapters/akb";
import type { LlmAdapter } from "../../adapters/llm";
import {
  type CodeSignal,
  inferStatusFromCodeSignal,
  isForwardStatus,
} from "../../models/status";
import {
  type PendingStatusChange,
  PendingStatusChangeSchema,
  type StatusChangeEvidence,
} from "../../schemas/activity/pendingDraft";
import type { StatusRationaleUserPromptRequest } from "../../schemas/ai/prompts";
import type { IssueMetadata } from "../../schemas/issues/metadata";
import { getAgentRegistryEntry } from "../framework/registry";
import { buildStatusRationaleUserPrompt } from "../prompts/statusRationale";
import { statusChangeToAgentArtifact } from "./artifacts";
import { type ScanActivityEventSink, runActivityAgentTask } from "./taskRunner";
import type { NormalisedActivity } from "./types";

const tracer = trace.getTracer("@reef/core");

interface GenerateStatusChangeForIssueParams {
  issueRef: string;
  bucket: NormalisedActivity[];
  akbAdapter: AkbAdapter;
  vault: string;
  llmAdapter: LlmAdapter;
  systemPrompt: string;
  detectedAt: string;
  onEvent?: ScanActivityEventSink;
}

export function deriveCodeSignal(bucket: NormalisedActivity[]): CodeSignal {
  const hasMergedPr = bucket.some((a) => a.noteInput.pr?.mergedAt != null);
  if (hasMergedPr) return "pr_merged";
  const hasOpenPr = bucket.some((a) => a.noteInput.pr !== undefined);
  if (hasOpenPr) return "pr_created";
  return "branch_created";
}

const SIGNAL_CONFIDENCE: Record<CodeSignal, number> = {
  pr_merged: 0.9,
  pr_created: 0.75,
  branch_created: 0.6,
};

export async function generateStatusChangeForIssue(
  params: GenerateStatusChangeForIssueParams,
): Promise<PendingStatusChange | null> {
  return runActivityAgentTask({
    taskId: "activity.status-change",
    execute: () => generateStatusChangeForIssueInner(params),
    toArtifact: statusChangeToAgentArtifact,
    onEvent: params.onEvent,
  });
}

async function generateStatusChangeForIssueInner(
  params: GenerateStatusChangeForIssueParams,
): Promise<PendingStatusChange | null> {
  const {
    issueRef,
    bucket,
    akbAdapter,
    vault,
    llmAdapter,
    systemPrompt,
    detectedAt,
  } = params;

  return tracer.startActiveSpan(
    "reef.agent.scanActivity.generateStatusChange",
    async (span) => {
      span.setAttribute("issue_ref", issueRef);
      span.setAttribute("evidence_count", bucket.length);
      try {
        let issueTitle: string;
        let fromStatus: IssueMetadata["status"];
        try {
          const result = await readIssue({
            adapter: akbAdapter,
            vault,
            id: issueRef,
          });
          issueTitle = result.issue.title;
          fromStatus = result.issue.status;
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          span.setAttribute("issue.read_failed", true);
          span.setAttribute("issue.read_error", detail.slice(0, 200));
          span.setStatus({ code: SpanStatusCode.OK });
          return null;
        }

        const signal = deriveCodeSignal(bucket);
        const toStatus = inferStatusFromCodeSignal(signal);
        span.setAttribute("code_signal", signal);
        span.setAttribute("from_status", fromStatus);
        span.setAttribute("target_status", toStatus);
        if (!isForwardStatus(fromStatus, toStatus)) {
          span.setAttribute("transition.skipped", true);
          span.setStatus({ code: SpanStatusCode.OK });
          return null;
        }

        const prEvidence = bucket.find((a) => a.noteInput.pr !== undefined);
        const commitEvidence = bucket
          .map((a) => a.noteInput.commit)
          .filter((c): c is NonNullable<typeof c> => c !== undefined);

        const firstActor = bucket[0]?.actor ?? "unknown";
        const sourceRepo = bucket[0]?.repo;

        const promptRequest: StatusRationaleUserPromptRequest = {
          issueId: issueRef,
          issueTitle,
          fromStatus,
          toStatus,
          actor: firstActor,
          sourceRepo,
          pr: prEvidence?.noteInput.pr,
          commits: commitEvidence.length > 0 ? commitEvidence : undefined,
        };

        const userPrompt = buildStatusRationaleUserPrompt(promptRequest);
        const { text } = await llmAdapter.generateText({
          model: llmAdapter.model(),
          system: systemPrompt,
          prompt: userPrompt,
          experimental_telemetry: {
            isEnabled: true,
            functionId: getAgentRegistryEntry("activity.status-change")
              .functionId,
          },
        });

        const trimmed = text.trim();
        if (trimmed === "null" || trimmed === "") {
          span.setAttribute("llm.null_response", true);
          span.setStatus({ code: SpanStatusCode.OK });
          return null;
        }

        let parsed: { rationale?: unknown };
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Failed to parse status-change JSON response",
          });
          return null;
        }
        if (parsed === null || typeof parsed !== "object") {
          span.setAttribute("llm.null_response", true);
          span.setStatus({ code: SpanStatusCode.OK });
          return null;
        }
        if (
          typeof parsed.rationale !== "string" ||
          parsed.rationale.length === 0
        ) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Status-change response missing 'rationale' field",
          });
          return null;
        }

        const evidence: StatusChangeEvidence[] = bucket.map((a) => ({
          type: a.type,
          ref: a.ref,
          repo: a.repo,
          actor: a.actor,
        }));

        const parsedStatusChange = PendingStatusChangeSchema.safeParse({
          id: crypto.randomUUID(),
          proposal: {
            operation: "update",
            update: {
              issue_id: issueRef,
              patch: { status: toStatus },
            },
          },
          issueTitle,
          fromStatus,
          rationale: parsed.rationale,
          evidence,
          confidence: SIGNAL_CONFIDENCE[signal],
          detectedAt,
          status: "pending",
          createdAt: detectedAt,
        });
        if (!parsedStatusChange.success) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Status change failed schema validation",
          });
          return null;
        }
        span.setStatus({ code: SpanStatusCode.OK });
        return parsedStatusChange.data;
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
