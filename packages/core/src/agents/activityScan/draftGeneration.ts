import { SpanStatusCode, trace } from "@opentelemetry/api";
import { stepCountIs } from "ai";
import type { AkbAdapter } from "../../adapters/akb";
import { readIssue } from "../../adapters/akb";
import type { LlmAdapter } from "../../adapters/llm";
import { inferStatusFromCodeSignal } from "../../models/status";
import {
  type PendingDraft,
  PendingDraftSchema,
} from "../../schemas/activity/pendingDraft";
import { getAgentRegistryEntry } from "../framework/registry";
import { buildAutoIssueUserPrompt } from "../prompts/autoIssue";
import { createIssueAuthoringToolset } from "../tools/toolsets";
import {
  activityDateForDraft,
  draftToAgentArtifact,
  implementationRefsForActivity,
  planningIdSets,
  safeIsoDate,
} from "./artifacts";
import { deriveCodeSignal } from "./statusChange";
import { type ScanActivityEventSink, runActivityAgentTask } from "./taskRunner";
import {
  type LlmDraftResponse,
  MAX_DRAFT_STEPS,
  type NormalisedActivity,
} from "./types";

const tracer = trace.getTracer("@reef/core");

interface GenerateDraftForActivityParams {
  activity: NormalisedActivity;
  akbAdapter: AkbAdapter;
  vault: string;
  llmAdapter: LlmAdapter;
  systemPrompt: string;
  repoFull: string;
  detectedAt: string;
  onEvent?: ScanActivityEventSink;
}

export async function generateDraftForActivity(
  params: GenerateDraftForActivityParams,
): Promise<PendingDraft | null> {
  return runActivityAgentTask({
    taskId: "activity.draft",
    execute: () => generateDraftForActivityInner(params),
    toArtifact: draftToAgentArtifact,
    onEvent: params.onEvent,
  });
}

async function generateDraftForActivityInner(
  params: GenerateDraftForActivityParams,
): Promise<PendingDraft | null> {
  const {
    activity,
    akbAdapter,
    vault,
    llmAdapter,
    systemPrompt,
    repoFull,
    detectedAt,
  } = params;

  return tracer.startActiveSpan(
    "reef.agent.scanActivity.generateDraft",
    async (span) => {
      span.setAttribute("activity.type", activity.type);
      span.setAttribute("activity.ref", activity.ref);
      try {
        const userPrompt = buildAutoIssueUserPrompt(
          activity.draftPromptRequest,
        );
        const tools = createIssueAuthoringToolset({
          adapter: akbAdapter,
          vault,
        });
        const { text } = await llmAdapter.generateText({
          model: llmAdapter.model(),
          system: systemPrompt,
          prompt: userPrompt,
          tools,
          stopWhen: stepCountIs(MAX_DRAFT_STEPS),
          experimental_telemetry: {
            isEnabled: true,
            functionId: getAgentRegistryEntry("activity.draft").functionId,
          },
        });

        const trimmed = text.trim();
        if (trimmed === "null" || trimmed === "") {
          span.setAttribute("llm.null_response", true);
          span.setStatus({ code: SpanStatusCode.OK });
          return null;
        }

        let llmResponse: LlmDraftResponse;
        try {
          llmResponse = JSON.parse(trimmed) as LlmDraftResponse;
        } catch {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Failed to parse draft JSON response",
          });
          return null;
        }

        const relationIds = await existingIssueIdSet({
          adapter: akbAdapter,
          vault,
          ids: [
            llmResponse.parent_id,
            ...(llmResponse.depends_on ?? []),
            ...(llmResponse.blocks ?? []),
            ...(llmResponse.related_to ?? []),
          ],
        });
        const parentId =
          llmResponse.parent_id && relationIds.has(llmResponse.parent_id)
            ? llmResponse.parent_id
            : undefined;
        const dependsOn = llmResponse.depends_on?.filter((id) =>
          relationIds.has(id),
        );
        const blocks = llmResponse.blocks?.filter((id) => relationIds.has(id));
        const relatedTo = llmResponse.related_to?.filter((id) =>
          relationIds.has(id),
        );
        const startDate =
          safeIsoDate(llmResponse.start_date) ?? activityDateForDraft(activity);
        const dueDate = safeIsoDate(llmResponse.due_date);
        const planningIds = planningIdSets(
          activity.draftPromptRequest.planningCatalog,
        );
        const milestoneId =
          planningIds && llmResponse.milestone_id
            ? planningIds.milestoneIds.has(llmResponse.milestone_id)
              ? llmResponse.milestone_id
              : undefined
            : undefined;
        const sprintId =
          planningIds && llmResponse.sprint_id
            ? planningIds.sprintIds.has(llmResponse.sprint_id)
              ? llmResponse.sprint_id
              : undefined
            : undefined;
        const releaseId =
          planningIds && llmResponse.release_id
            ? planningIds.releaseIds.has(llmResponse.release_id)
              ? llmResponse.release_id
              : undefined
            : undefined;

        const parsed = PendingDraftSchema.safeParse({
          id: crypto.randomUUID(),
          proposal: {
            operation: "create",
            create: {
              fields: {
                // A draft is born from a code signal (branch/PR/merge), so the
                // proposed issue is likely already in flight — land it at the
                // inferred lifecycle status rather than the human default
                // (`backlog`). `buildIssueMetadataFromCreateInput` passes this
                // through; omitting it would inherit `DEFAULT_NEW_ISSUE_STATUS`
                // (REEF-130).
                status: inferStatusFromCodeSignal(deriveCodeSignal([activity])),
                title: llmResponse.title,
                issue_type: llmResponse.issue_type,
                priority: llmResponse.priority,
                assigned_to: llmResponse.assigned_to,
                requester: llmResponse.requester,
                reporter: llmResponse.reporter,
                start_date: startDate,
                due_date: dueDate,
                milestone_id: milestoneId,
                sprint_id: sprintId,
                release_id: releaseId,
                estimate_points: llmResponse.estimate_points,
                severity: llmResponse.severity,
                parent_id: parentId,
                depends_on:
                  dependsOn && dependsOn.length > 0 ? dependsOn : undefined,
                blocks: blocks && blocks.length > 0 ? blocks : undefined,
                related_to:
                  relatedTo && relatedTo.length > 0 ? relatedTo : undefined,
                implementation_refs: implementationRefsForActivity(
                  activity,
                  detectedAt,
                ),
                labels: llmResponse.labels,
              },
              content: llmResponse.content,
            },
          },
          provenance: {
            type: activity.type,
            ref: activity.ref,
            repo: repoFull,
            actor: activity.actor,
            detectedAt,
          },
          confidence: llmResponse.confidence,
          reasoning: llmResponse.reasoning,
          status: "pending",
          createdAt: detectedAt,
        });
        if (!parsed.success) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Draft failed schema validation",
          });
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

async function existingIssueIdSet({
  adapter,
  vault,
  ids,
}: {
  adapter: AkbAdapter;
  vault: string;
  ids: Array<string | undefined>;
}): Promise<ReadonlySet<string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Set();

  const found = await Promise.all(
    unique.map(async (id) => {
      try {
        await readIssue({ adapter, vault, id });
        return id;
      } catch {
        return null;
      }
    }),
  );
  return new Set(found.filter((id): id is string => id !== null));
}
