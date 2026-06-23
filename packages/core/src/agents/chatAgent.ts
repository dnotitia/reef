import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  type InferUITools,
  ToolLoopAgent,
  type UIMessage,
  createAgentUIStreamResponse,
  stepCountIs,
} from "ai";
import { type AkbAdapter, readConfig } from "../adapters/akb";
import type { GitHubAdapter } from "../adapters/github";
import type { LlmAdapter } from "../adapters/llm";
import { type AgentRunEvent, AgentRunEventSchema } from "./framework/events";
import {
  type AgentTaskRegistryEntry,
  getAgentRegistryEntry,
} from "./framework/registry";
import type { RepoRef } from "./tools/repo";
import {
  createRepoReadToolset,
  createWorkspaceReadToolset,
} from "./tools/toolsets";

const tracer = trace.getTracer("@reef/core");
const WORKSPACE_CHAT_TASK_ID = "chat.workspace";

export interface CreateChatAgentToolsParams {
  /** Per-request akb adapter (vault-scoped operations). */
  adapter: AkbAdapter;
  /** Per-request GitHub adapter (monitored-repo grounding), when connected. */
  githubAdapter?: GitHubAdapter;
  /** Active vault name — closure-bound into every akb tool. */
  vault: string;
  /**
   * The active vault's monitored repositories, used to scope the unbound repo
   * tools (REEF-243). Resolved by `createWorkspaceChatAgentResponse`; when
   * undefined or empty, no repo tools are wired.
   */
  allowedRepos?: RepoRef[];
}

export interface WorkspaceChatStepSummary {
  stepIndex: number;
  finishReason: string;
  toolNames: string[];
}

export interface CreateWorkspaceChatAgentResponseParams
  extends CreateChatAgentToolsParams {
  /** Per-request LLM adapter. */
  llmAdapter: LlmAdapter;
  /** Validated AI SDK UI messages from the BFF boundary. */
  messages: UIMessage[];
  onStepFinish?: (summary: WorkspaceChatStepSummary) => void;
  onFinish?: () => void;
  onError?: (error: unknown) => string;
  onEvent?: (event: AgentRunEvent) => void;
}

/**
 * Factory that assembles the reef AI SDK tools for the chat agent loop.
 *
 * Chat scope is read grounding:
 *   1. **Vault reads** — `read_issue`, `search_issues`, `list_assignees`
 *      read from the active akb vault.
 *   2. **Code grounding** — `search_code`, `dev_read_file` query the vault's
 *      monitored GitHub repos when the deployment GitHub App is configured.
 *      The tools are scoped to `monitored_repos`, so a broad App token cannot
 *      read a repository the vault does not monitor.
 *
 * No vault-mutating tools are registered here. Issue creation and edits go
 * through dedicated Route Handlers (`/api/issues`, `/api/issues/[id]`,
 * `/api/drafts/approve`) with their own confirmation UI, not the chat loop.
 *
 * Both adapters and `vault` are bound for the lifetime of one Route Handler
 * request. The akb-scoped tools does not expose `vault` in their inputSchemas —
 * closure binding prevents prompt-injected cross-vault reads.
 */
function createChatAgentTools(params: CreateChatAgentToolsParams) {
  return tracer.startActiveSpan(
    "reef.agent.createChatTools",
    (span): ReturnType<typeof buildTools> => {
      try {
        const tools = buildTools(params);
        span.setStatus({ code: SpanStatusCode.OK });
        return tools;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

export function getWorkspaceChatTaskConfig(): AgentTaskRegistryEntry {
  return getAgentRegistryEntry(WORKSPACE_CHAT_TASK_ID);
}

export async function createWorkspaceChatAgentResponse(
  params: CreateWorkspaceChatAgentResponseParams,
): Promise<Response> {
  const taskConfig = getWorkspaceChatTaskConfig();
  const allowedRepos = await resolveMonitoredRepos(params);
  const tools = createChatAgentTools({ ...params, allowedRepos });
  type WorkspaceChatToolset = typeof tools;
  type WorkspaceChatUIMessage = UIMessage<
    unknown,
    never,
    InferUITools<WorkspaceChatToolset>
  >;
  const uiMessages = params.messages as unknown as WorkspaceChatUIMessage[];

  const lifecycle = createWorkspaceChatLifecycle(taskConfig, params);
  lifecycle.emitStarted();

  try {
    let stepCounter = 0;
    const agent = new ToolLoopAgent({
      model: params.llmAdapter.model(),
      tools,
      stopWhen: stepCountIs(taskConfig.maxSteps ?? 10),
      experimental_telemetry: {
        isEnabled: true,
        functionId: taskConfig.functionId,
      },
      onStepFinish: (stepResult) => {
        const toolNames = stepResult.toolCalls.flatMap((toolCall) =>
          toolCall?.toolName ? [toolCall.toolName] : [],
        );
        params.onStepFinish?.({
          stepIndex: stepCounter++,
          finishReason: stepResult.finishReason,
          toolNames,
        });
      },
      onFinish: () => {
        lifecycle.emitCompleted();
        params.onFinish?.();
      },
    });

    return await createAgentUIStreamResponse<never, WorkspaceChatToolset>({
      agent,
      uiMessages,
      originalMessages: uiMessages,
      onError: (error) => {
        lifecycle.emitError(error);
        const fallback =
          error instanceof Error ? error.message : "stream error";
        return params.onError?.(error) ?? fallback;
      },
    });
  } catch (err) {
    lifecycle.emitError(err);
    throw err;
  }
}

function buildTools({
  adapter,
  githubAdapter,
  vault,
  allowedRepos,
}: CreateChatAgentToolsParams) {
  // Wire repo grounding only when GitHub is connected AND the vault monitors at
  // least one repo. With nothing to ground on there is no useful repo tool to
  // offer, and the tools would reject every call anyway (REEF-243).
  const groundRepos = Boolean(githubAdapter) && (allowedRepos?.length ?? 0) > 0;
  return {
    ...(groundRepos && githubAdapter
      ? createRepoReadToolset({ githubAdapter, allowedRepos })
      : {}),
    ...createWorkspaceReadToolset({ adapter, vault }),
  };
}

/**
 * Resolve the active vault's monitored repositories so the unbound chat repo
 * tools can be scoped to them (REEF-243). Best-effort: with no GitHub grounding
 * connected, or if the config read fails, return undefined so chat proceeds
 * AKB-only (no repo tools) rather than failing or grounding unbounded.
 */
async function resolveMonitoredRepos({
  adapter,
  githubAdapter,
  vault,
}: CreateChatAgentToolsParams): Promise<RepoRef[] | undefined> {
  if (!githubAdapter) return undefined;
  try {
    const { config } = await readConfig({ adapter, vault });
    return config.monitored_repos.map((repo) => ({
      owner: repo.owner,
      repo: repo.name,
    }));
  } catch {
    return undefined;
  }
}

function createWorkspaceChatLifecycle(
  taskConfig: AgentTaskRegistryEntry,
  params: CreateWorkspaceChatAgentResponseParams,
) {
  const runId = createRunId(taskConfig.taskId);
  let seq = 0;
  let terminalEmitted = false;

  const emit = (event: unknown) => {
    if (!params.onEvent) return;
    params.onEvent(AgentRunEventSchema.parse(event));
  };

  const baseEvent = () => ({
    event_id: `${runId}:${seq}`,
    run_id: runId,
    task_id: taskConfig.taskId,
    seq: seq++,
    created_at: new Date().toISOString(),
    metadata: {
      function_id: taskConfig.functionId,
      execution_mode: taskConfig.executionMode,
    },
  });

  const emitTerminal = (
    event:
      | {
          type: "run.completed";
          run_status: "completed";
          artifact_ids: string[];
          usage: Record<string, unknown>;
        }
      | {
          type: "run.error";
          run_status: "error";
          error: {
            code: string;
            message: string;
            recoverable: boolean;
            details: Record<string, unknown>;
          };
        },
  ) => {
    if (terminalEmitted) return;
    terminalEmitted = true;
    emit({ ...baseEvent(), ...event });
  };

  return {
    emitStarted: () =>
      emit({
        ...baseEvent(),
        type: "run.started",
        run_status: "running",
        input: {
          message_count: params.messages.length,
          vault: params.vault,
          toolset_policy: taskConfig.toolsetPolicy,
          max_steps: taskConfig.maxSteps,
        },
      }),
    emitCompleted: () =>
      emitTerminal({
        type: "run.completed",
        run_status: "completed",
        artifact_ids: [],
        usage: {},
      }),
    emitError: (error: unknown) =>
      emitTerminal({
        type: "run.error",
        run_status: "error",
        error: {
          code: "workspace_chat_stream_error",
          message:
            error instanceof Error
              ? error.message
              : String(error || "stream error"),
          recoverable: false,
          details: {},
        },
      }),
  };
}

function createRunId(taskId: string): string {
  return `${taskId}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
