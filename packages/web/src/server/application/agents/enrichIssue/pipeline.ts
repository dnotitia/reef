import type { GitHubAdapter } from "@/server/adapters/githubAdapter";
import type { LlmAdapter } from "@/server/adapters/llmAdapter";
import type {
  AkbAdapter,
  EnrichmentContext,
  EnrichmentRepoContext,
  EnrichmentRequest,
  EnrichmentResult,
  EnrichmentSuggestion,
  ReferenceSuggestion,
} from "@reef/core";
import { LlmError } from "@reef/core";
import { isStepCount } from "ai";
import { AgentFieldSuggestionArtifactSchema } from "../framework/events";
import {
  type AgentRunLifecycle,
  agentErrorFromUnknown,
} from "../framework/lifecycle";
import {
  buildEnrichmentRepairPrompt,
  buildEnrichmentRepairSystemPrompt,
  buildEnrichmentSystemPrompt,
  buildEnrichmentUserPrompt,
} from "../prompts/enrichment";
import {
  createIssueAuthoringToolset,
  createRepoReadToolset,
} from "../tools/toolsets";
import { buildEnrichmentContext, resolveVerifiedRepoContext } from "./context";
import {
  parseEnrichmentReferences,
  parseEnrichmentResponse,
  parseEnrichmentResult,
  rescueEmptyText,
  validateReferences,
  validateSuggestions,
} from "./validation";

const MAX_ENRICHMENT_STEPS = 6;
const MAX_REPAIR_RESPONSE_CHARS = 6000;
const JSON_TEXT_OUTPUT = {
  name: "reef_enrichment_json_text",
  responseFormat: Promise.resolve({ type: "json" as const }),
  async parseCompleteOutput({ text }: { text: string }) {
    return text;
  },
  async parsePartialOutput() {
    return undefined;
  },
  createElementStreamTransform() {
    return undefined;
  },
};

type EnrichmentGenerateOptions = Parameters<LlmAdapter["generateText"]>[0];
type EnrichmentToolset = NonNullable<EnrichmentGenerateOptions["tools"]>;
type EnrichmentGenerateResult = Awaited<ReturnType<LlmAdapter["generateText"]>>;

export interface IssueEnrichmentState {
  adapter: LlmAdapter;
  akbAdapter?: AkbAdapter;
  githubAdapter?: GitHubAdapter;
  request: EnrichmentRequest;
  authoringLanguage: string | null;
  context: EnrichmentContext;
  verifiedRepoContext?: EnrichmentRepoContext;
  system: string;
  user: string;
  tools: EnrichmentToolset;
  generationResult?: EnrichmentGenerateResult;
  rawText: string;
  rawSuggestions: unknown[];
  suggestions: EnrichmentSuggestion[];
  rawReferences: unknown[];
  references: ReferenceSuggestion[];
  needsRepair: boolean;
  repairReason: string;
}

export interface IssueEnrichmentPipelineResult {
  result: EnrichmentResult;
  artifactId: string | null;
  finishReason: string | null;
  usage: Record<string, unknown>;
}

export function createIssueEnrichmentState({
  adapter,
  akbAdapter,
  githubAdapter,
  request,
  authoringLanguage,
}: {
  adapter: LlmAdapter;
  akbAdapter?: AkbAdapter;
  githubAdapter?: GitHubAdapter;
  request: EnrichmentRequest;
  authoringLanguage?: string | null;
}): IssueEnrichmentState {
  return {
    adapter,
    akbAdapter,
    githubAdapter,
    request,
    authoringLanguage: authoringLanguage ?? null,
    context: { labels: [], members: [], templates: [], knownIssueIds: [] },
    system: "",
    user: "",
    tools: {},
    rawText: "",
    rawSuggestions: [],
    suggestions: [],
    rawReferences: [],
    references: [],
    needsRepair: false,
    repairReason: "",
  };
}

export async function runIssueEnrichmentPipeline({
  state,
  span,
  lifecycle,
}: {
  state: IssueEnrichmentState;
  span: {
    setAttribute: (key: string, value: string | number | boolean) => void;
  };
  lifecycle: AgentRunLifecycle;
}): Promise<IssueEnrichmentPipelineResult> {
  await runStage(lifecycle, "prepareContext", async () => {
    state.system = buildEnrichmentSystemPrompt(state.authoringLanguage);
    state.context = await buildEnrichmentContext({
      akbAdapter: state.akbAdapter,
      vault: state.request.vault,
      span,
    });
    state.verifiedRepoContext = await resolveVerifiedRepoContext({
      akbAdapter: state.akbAdapter,
      vault: state.request.vault,
      repoContext: state.request.repoContext,
      span,
    });
    span.setAttribute(
      "enrichment.verified_repo",
      state.verifiedRepoContext
        ? `${state.verifiedRepoContext.owner}/${state.verifiedRepoContext.repo}`
        : "none",
    );
    return {
      known_issue_count: state.context.knownIssueIds.length,
      template_count: state.context.templates.length,
    };
  });

  await runStage(lifecycle, "buildPrompt", () => {
    state.user = buildEnrichmentUserPrompt({
      issueId: state.request.issueId,
      draft: state.request.draft,
      context: state.context,
      ...(state.verifiedRepoContext
        ? { repoContext: state.verifiedRepoContext }
        : {}),
    });
    return {
      system_chars: state.system.length,
      user_chars: state.user.length,
    };
  });

  await runStage(lifecycle, "buildTools", () => {
    state.tools = {
      ...(state.akbAdapter
        ? createIssueAuthoringToolset({
            adapter: state.akbAdapter,
            vault: state.request.vault,
            includeAssignees: true,
          })
        : {}),
      ...(state.githubAdapter && state.verifiedRepoContext
        ? createRepoReadToolset({
            githubAdapter: state.githubAdapter,
            repoContext: state.verifiedRepoContext,
          })
        : {}),
    };
    return { tool_names: Object.keys(state.tools) };
  });

  await runStage(lifecycle, "execute", async () => {
    const result = await state.adapter.generateText({
      model: state.adapter.model(),
      system: state.system,
      prompt: state.user,
      tools: state.tools,
      stopWhen: isStepCount(MAX_ENRICHMENT_STEPS),
      telemetry: {
        isEnabled: true,
        functionId: "reef.agent.issue.enrichment",
        recordInputs: false,
        recordOutputs: false,
      },
      output: JSON_TEXT_OUTPUT,
      temperature: 0.3,
      maxOutputTokens: 4096,
    });
    state.generationResult = result;
    state.rawText = result.text;
    span.setAttribute("enrichment.response_length", result.text.length);
    span.setAttribute(
      "enrichment.finish_reason",
      result.finishReason ?? "unknown",
    );
    if (result.usage) {
      span.setAttribute(
        "enrichment.usage.prompt_tokens",
        result.usage.inputTokens ?? 0,
      );
      span.setAttribute(
        "enrichment.usage.completion_tokens",
        result.usage.outputTokens ?? 0,
      );
    }
    return { response_length: result.text.length };
  });

  await runStage(lifecycle, "decode", () => {
    if (!state.rawText.trim()) {
      span.setAttribute(
        "enrichment.result_keys",
        state.generationResult
          ? Object.keys(state.generationResult as object).join(",")
          : "",
      );
      const rescued = rescueEmptyText(state.generationResult);
      if (!rescued) {
        const usage = state.generationResult?.usage;
        throw new LlmError({
          message: `Enrichment response was empty (finishReason=${
            state.generationResult?.finishReason ?? "unknown"
          }, completion_tokens=${
            usage?.outputTokens ?? "?"
          }). The model returned no usable text. Try a different model in Settings, or check whether your provider routes output to a non-standard field (some reasoning-only models do this).`,
        });
      }
      state.rawText = rescued;
      span.setAttribute("enrichment.rescued_from", "rescued");
    }

    try {
      decodeResult(state, state.rawText);
      state.needsRepair = false;
      state.repairReason = "";
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      state.rawSuggestions = [];
      state.suggestions = [];
      state.rawReferences = [];
      state.references = [];
      state.needsRepair = true;
      state.repairReason = error.context.message;
      span.setAttribute("enrichment.repair.started", true);
    }
    return {
      raw_suggestion_count: state.rawSuggestions.length,
      needs_repair: state.needsRepair,
    };
  });

  await runStage(lifecycle, "repair", async () => {
    if (!state.needsRepair) return { skipped: true };
    let repairedText = "";
    try {
      const repair = await state.adapter.generateText({
        model: state.adapter.model(),
        system: buildEnrichmentRepairSystemPrompt(),
        prompt: buildEnrichmentRepairPrompt({
          originalPrompt: `${state.system}\n\n${state.user}`,
          invalidResponse: state.rawText.slice(0, MAX_REPAIR_RESPONSE_CHARS),
        }),
        output: JSON_TEXT_OUTPUT,
        temperature: 0,
        maxOutputTokens: 2048,
      });
      repairedText = repair.text;
      span.setAttribute(
        "enrichment.repair.response_length",
        repairedText.length,
      );
      decodeResult(state, repairedText);
      state.needsRepair = false;
      span.setAttribute("enrichment.repair.succeeded", true);
      return { suggestion_count: state.suggestions.length };
    } catch (error) {
      span.setAttribute("enrichment.repair.succeeded", false);
      if (!repairedText.trim()) throw error;
      state.rawSuggestions = [];
      state.suggestions = [];
      state.rawReferences = [];
      state.references = [];
      return { suggestion_count: 0 };
    }
  });

  let artifactId: string | null = null;
  const result = await runStage(lifecycle, "normalize", () => {
    const normalized = parseEnrichmentResult({
      suggestions: state.suggestions,
      references: state.references,
    });
    span.setAttribute(
      "enrichment.suggestion_count",
      normalized.suggestions.length,
    );
    span.setAttribute(
      "enrichment.reference_count",
      normalized.references.length,
    );
    if (normalized.suggestions.length > 0 || normalized.references.length > 0) {
      artifactId = `${lifecycle.runId}:field-suggestions`;
      lifecycle.emit({
        type: "artifact.final",
        artifact: AgentFieldSuggestionArtifactSchema.parse({
          artifact_id: artifactId,
          run_id: lifecycle.runId,
          task_id: "issue.enrichment",
          type: "field_suggestion",
          created_at: new Date().toISOString(),
          metadata: {},
          payload: {
            issue_id: state.request.issueId,
            suggestions: normalized.suggestions,
            references: normalized.references,
          },
        }),
      });
    }
    return normalized;
  });

  return {
    result,
    artifactId,
    finishReason: state.generationResult?.finishReason ?? null,
    usage: {
      inputTokens: state.generationResult?.usage?.inputTokens ?? 0,
      outputTokens: state.generationResult?.usage?.outputTokens ?? 0,
    },
  };
}

function decodeResult(state: IssueEnrichmentState, text: string): void {
  state.rawSuggestions = parseEnrichmentResponse(text);
  state.suggestions = validateSuggestions(state.rawSuggestions, {
    context: state.context,
  });
  state.rawReferences = parseEnrichmentReferences(text);
  state.references = validateReferences(state.rawReferences);
}

async function runStage<T extends Record<string, unknown>>(
  lifecycle: AgentRunLifecycle,
  stageId: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  const stage = { stage_id: stageId, name: stageId };
  lifecycle.emit({ type: "stage.started", stage });
  try {
    const output = await operation();
    lifecycle.emit({ type: "stage.completed", stage, output });
    return output;
  } catch (error) {
    lifecycle.emit({
      type: "stage.error",
      stage,
      error: agentErrorFromUnknown(error, "enrichment_stage_failed"),
    });
    throw error;
  }
}
