import { stepCountIs } from "ai";
import type { AkbAdapter } from "../../adapters/akb";
import type { GitHubAdapter } from "../../adapters/github";
import type { LlmAdapter } from "../../adapters/llm";
import { LlmError } from "../../errors";
import type {
  EnrichmentContext,
  EnrichmentRepoContext,
  EnrichmentRequest,
  EnrichmentResult,
  EnrichmentSuggestion,
  ReferenceSuggestion,
} from "../../schemas/ai/enrichment";
import { extractErrorDetail } from "../../utils/extractErrorDetail";
import { AgentFieldSuggestionArtifactSchema } from "../framework/events";
import type { AgentStageHandlerMap } from "../framework/registry";
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
  averageConfidence,
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
  /** Workspace default authoring language (REEF-136); null preserves prior behavior. */
  authoringLanguage?: string | null;
  context: EnrichmentContext;
  verifiedRepoContext?: EnrichmentRepoContext;
  system: string;
  user: string;
  tools?: EnrichmentToolset;
  generationResult?: EnrichmentGenerateResult;
  rawText: string;
  rawSuggestions: unknown[];
  suggestions: EnrichmentSuggestion[];
  rawReferences: unknown[];
  references: ReferenceSuggestion[];
  needsRepair: boolean;
  repairReason: string;
  result?: EnrichmentResult;
  error?: unknown;
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
    rawText: "",
    rawSuggestions: [],
    suggestions: [],
    rawReferences: [],
    references: [],
    needsRepair: false,
    repairReason: "",
  };
}

export function buildIssueEnrichmentStageHandlers(span: {
  setAttribute: (key: string, value: string | number | boolean) => void;
}): AgentStageHandlerMap<IssueEnrichmentState> {
  return {
    prepareContext: async ({ state }) => {
      try {
        // Generated suggestions are written in the workspace's authoring
        // language when set (REEF-136); null preserves prior behavior.
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
          state,
          output: {
            known_issue_count: state.context.knownIssueIds.length,
            template_count: state.context.templates.length,
          },
        };
      } catch (err) {
        return rethrowStageError(state, err);
      }
    },
    buildPrompt: ({ state }) => {
      try {
        state.user = buildEnrichmentUserPrompt({
          issueId: state.request.issueId,
          draft: state.request.draft,
          context: state.context,
          ...(state.verifiedRepoContext
            ? { repoContext: state.verifiedRepoContext }
            : {}),
        });
        return {
          state,
          output: {
            system_chars: state.system.length,
            user_chars: state.user.length,
          },
        };
      } catch (err) {
        return rethrowStageError(state, err);
      }
    },
    buildTools: ({ state }) => {
      try {
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
        return {
          state,
          output: { tool_names: Object.keys(state.tools).join(",") },
        };
      } catch (err) {
        return rethrowStageError(state, err);
      }
    },
    execute: async ({ state }) => {
      try {
        const result = await state.adapter.generateText({
          model: state.adapter.model(),
          system: state.system,
          prompt: state.user,
          tools: state.tools ?? {},
          stopWhen: stepCountIs(MAX_ENRICHMENT_STEPS),
          output: JSON_TEXT_OUTPUT,
          temperature: 0.3,
          maxOutputTokens: 4096,
        });
        state.generationResult = result;
        state.rawText = result.text;
        span.setAttribute(
          "enrichment.response_preview",
          result.text.slice(0, 200),
        );
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
        return {
          state,
          usage: {
            inputTokens: result.usage?.inputTokens ?? 0,
            outputTokens: result.usage?.outputTokens ?? 0,
          },
          finish_reason: result.finishReason ?? null,
          output: { response_length: result.text.length },
        };
      } catch (err) {
        return rethrowStageError(state, err);
      }
    },
    decode: ({ state }) => {
      try {
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
          state.rawSuggestions = parseEnrichmentResponse(state.rawText);
          state.suggestions = validateSuggestions(state.rawSuggestions, {
            context: state.context,
          });
          state.rawReferences = parseEnrichmentReferences(state.rawText);
          state.references = validateReferences(state.rawReferences);
          state.needsRepair = false;
          state.repairReason = "";
        } catch (err) {
          if (!(err instanceof LlmError)) throw err;
          state.rawSuggestions = [];
          state.suggestions = [];
          state.needsRepair = true;
          state.repairReason = err.context.message;
          span.setAttribute("enrichment.repair.started", true);
          span.setAttribute(
            "enrichment.repair.reason",
            err.context.message.slice(0, 200),
          );
        }
        return {
          state,
          output: {
            raw_suggestion_count: state.rawSuggestions.length,
            needs_repair: state.needsRepair,
          },
        };
      } catch (err) {
        return rethrowStageError(state, err);
      }
    },
    repair: async ({ emit, state }) => {
      if (!state.needsRepair) {
        return { state, output: { skipped: true } };
      }

      emit({
        type: "repair.started",
        repair: {
          attempt: 1,
          reason: state.repairReason,
          policy: "json-repair",
        },
      });

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
        state.rawSuggestions = parseEnrichmentResponse(repairedText);
        state.suggestions = validateSuggestions(state.rawSuggestions, {
          context: state.context,
        });
        state.rawReferences = parseEnrichmentReferences(repairedText);
        state.references = validateReferences(state.rawReferences);
        state.needsRepair = false;
        span.setAttribute("enrichment.repair.succeeded", true);
        emit({
          type: "repair.completed",
          repair: {
            attempt: 1,
            reason: state.repairReason,
            policy: "json-repair",
          },
          output: { suggestion_count: state.suggestions.length },
        });
        return {
          state,
          output: { suggestion_count: state.suggestions.length },
        };
      } catch (err) {
        span.setAttribute("enrichment.repair.succeeded", false);
        span.setAttribute(
          "enrichment.repair.error",
          extractErrorDetail(err).slice(0, 200),
        );
        emit({
          type: "repair.failed",
          repair: {
            attempt: 1,
            reason: state.repairReason,
            policy: "json-repair",
          },
          error: {
            code: err instanceof Error ? err.name : "repair_failed",
            message: extractErrorDetail(err),
            recoverable: false,
            details: {},
          },
        });
        if (!repairedText.trim()) {
          return rethrowStageError(state, err);
        }
        state.rawSuggestions = [];
        state.suggestions = [];
        return { state, output: { suggestion_count: 0 } };
      }
    },
    normalize: ({ emit, run_id, state, task_id }) => {
      try {
        state.result = parseEnrichmentResult({
          suggestions: state.suggestions,
          references: state.references,
        });
        span.setAttribute(
          "enrichment.suggestion_count",
          state.result.suggestions.length,
        );
        span.setAttribute(
          "enrichment.reference_count",
          state.result.references.length,
        );
        if (state.result.suggestions.length > 0) {
          emit({
            type: "artifact.final",
            artifact: AgentFieldSuggestionArtifactSchema.parse({
              artifact_id: `${run_id}:field-suggestions`,
              run_id,
              task_id,
              type: "field_suggestion",
              status: "pending",
              title: `Field suggestions for ${state.request.issueId}`,
              confidence: averageConfidence(state.result.suggestions),
              reasoning: "Issue enrichment normalized field suggestions.",
              evidence: [],
              warnings: [],
              created_at: new Date().toISOString(),
              updated_at: null,
              metadata: {},
              payload: {
                issue_id: state.request.issueId,
                suggestions: state.result.suggestions,
              },
            }),
          });
        }
        return {
          state,
          output: { suggestion_count: state.result.suggestions.length },
        };
      } catch (err) {
        return rethrowStageError(state, err);
      }
    },
    "present/persist": ({ state }) => ({
      state,
      final_status:
        state.result &&
        (state.result.suggestions.length > 0 ||
          state.result.references.length > 0)
          ? "completed"
          : "empty",
      output: {
        suggestion_count: state.result?.suggestions.length ?? 0,
        reference_count: state.result?.references.length ?? 0,
      },
    }),
  };
}

function rethrowStageError(state: IssueEnrichmentState, err: unknown): never {
  state.error = err;
  throw err;
}
