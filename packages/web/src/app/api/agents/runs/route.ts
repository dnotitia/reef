import { extractVault } from "@/lib/akb/extractVault";
import { AUTH_ACCOUNT_ERROR_HEADER } from "@/lib/akb/headers";
import { localizedAgentError } from "@/lib/api/errorLocalization";
import { getAkbAdapter, getAkbCurrentActor } from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import type { GitHubAdapter } from "@/server/adapters/githubAdapter";
import { resolveGroundingGitHubAdapter } from "@/server/adapters/githubCredentials/resolveGroundingGitHubAdapter";
import {
  ServerLlmConfigError,
  createServerLlmAdapter,
  getRequiredServerLlmConfig,
} from "@/server/adapters/llmConfig/serverConfig";
import {
  createWorkspaceChatAgentResponse,
  enrichIssue,
} from "@/server/application/agents";
import {
  AgentRunRequestSchema,
  AuthError,
  akbReadAuthoringLanguage,
} from "@reef/core";
import type { UIMessage } from "ai";
import { z } from "zod";
import {
  createAgentEventStream,
  createChatRunEventBridge,
  drainUiMessageStream,
} from "./stream";

async function agentAccountError(response: Response): Promise<Response> {
  // Account denials carry localized copy and session-clearing cookies from the
  // shared AKB boundary. Plain 401 and backend failures retain the structured
  // agent error contract while inheriting operational headers such as cookie
  // clearing and no-store from the underlying auth response.
  if (response.headers.has(AUTH_ACCOUNT_ERROR_HEADER)) {
    return response;
  }

  const agentResponse = await (response.status === 401
    ? localizedAgentError(
        "agent.workspaceAuthRequired",
        401,
        "workspace_auth_required",
      )
    : localizedAgentError(
        "agent.workspaceUnavailable",
        response.status,
        "workspace_unavailable",
      ));
  for (const [name, value] of response.headers) {
    if (name === "set-cookie") {
      agentResponse.headers.append(name, value);
      continue;
    }
    if (name === "content-length" || name === "content-type") continue;
    agentResponse.headers.set(name, value);
  }
  return agentResponse;
}

/**
 * POST /api/agents/runs — unified agent runtime entrypoint.
 *
 * Accepts `{ task_id, input }`, validates task-specific input through
 * `AgentRunRequestSchema`, invokes the matching core task, and streams typed
 * `AgentRunEvent` SSE frames. This route is the common contract for
 * framework-driven runs.
 */
export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return localizedAgentError(
      "agent.runRequestInvalid",
      400,
      "invalid_json_body",
    );
  }

  const parsed = AgentRunRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return localizedAgentError(
      "agent.runRequestInvalid",
      400,
      "invalid_agent_run_request",
      { validation: z.flattenError(parsed.error) },
    );
  }
  const runRequest = parsed.data;

  const akb = getAkbAdapter(request);
  if ("response" in akb) {
    const authResponse = await akb.response;
    return agentAccountError(authResponse);
  }

  // Validate every task before LLM or GitHub capability checks can short-circuit
  // the account boundary. This keeps account-denial cookies intact even when an
  // optional deployment capability is unavailable.
  const account = await getAkbCurrentActor(request);
  if ("response" in account) {
    return agentAccountError(account.response);
  }

  let llmConfig: ReturnType<typeof getRequiredServerLlmConfig>;
  try {
    llmConfig = getRequiredServerLlmConfig();
  } catch (err) {
    if (!(err instanceof ServerLlmConfigError)) {
      logger.error(
        { err, task_id: runRequest.task_id },
        "agent_run_llm_config_unexpected_error",
      );
    }
    return localizedAgentError(
      "aiUnavailableDeployment",
      503,
      "llm_unavailable",
    );
  }

  const llmAdapter = createServerLlmAdapter(llmConfig);

  if (runRequest.task_id === "chat.workspace") {
    let vault: string;
    try {
      vault = extractVault(request);
    } catch (err) {
      if (err instanceof AuthError) {
        return localizedAgentError(
          "agent.vaultRequired",
          401,
          "vault_required",
        );
      }
      throw err;
    }

    // Server-managed GitHub App just; any GitHub unavailability degrades to
    // AKB scoped grounding (REEF-243 / REEF-244). The
    // credential does not reach the response or the LLM prompt.
    const githubResolution = await resolveGroundingGitHubAdapter(request);
    if (githubResolution.kind === "degraded" && githubResolution.error) {
      logger.warn(
        { err: githubResolution.error, task_id: runRequest.task_id, vault },
        "agent_run_chat_grounding_github_app_unavailable",
      );
    }
    const githubAdapter =
      githubResolution.kind === "adapter"
        ? githubResolution.adapter
        : undefined;
    return createAgentEventStream(
      "chat.workspace",
      request.signal,
      async (writeEvent, signal) => {
        const chatEvents = createChatRunEventBridge(writeEvent);
        try {
          if (signal.aborted) return;
          const response = await createWorkspaceChatAgentResponse({
            adapter: akb.adapter,
            ...(githubAdapter ? { githubAdapter } : {}),
            vault,
            llmAdapter,
            messages: runRequest.input.messages as UIMessage[],
            // Same grounding seam from REEF-360 AC1: forward the route/issue
            // hints when the caller supplies them.
            route: runRequest.input.route,
            currentIssueId: runRequest.input.reefId,
            onEvent: chatEvents.onLifecycleEvent,
            onError: (error) =>
              error instanceof Error ? error.message : "stream error",
          });
          await drainUiMessageStream(
            response,
            chatEvents.onUiMessageChunk,
            signal,
          );
        } finally {
          if (!signal.aborted) chatEvents.flushTerminal();
        }
      },
    );
  }

  if (runRequest.task_id === "issue.enrichment") {
    // Code grounding just matters when the run carries a monitored repo.
    // Server-managed GitHub App just; any GitHub unavailability degrades to
    // AKB scoped enrichment (REEF-243 / REEF-244).
    let githubAdapter: GitHubAdapter | undefined;
    if (runRequest.input.repoContext) {
      const githubResolution = await resolveGroundingGitHubAdapter(request);
      if (githubResolution.kind === "degraded" && githubResolution.error) {
        logger.warn(
          {
            err: githubResolution.error,
            task_id: runRequest.task_id,
            issue_id: runRequest.input.issueId,
          },
          "agent_run_enrichment_grounding_github_app_unavailable",
        );
      }
      if (githubResolution.kind === "adapter") {
        githubAdapter = githubResolution.adapter;
      }
    }

    return createAgentEventStream(
      "issue.enrichment",
      request.signal,
      async (writeEvent, signal) => {
        if (signal.aborted) return;
        const authoringLanguage = await akbReadAuthoringLanguage({
          adapter: akb.adapter,
          vault: runRequest.input.vault,
        });
        if (signal.aborted) return;
        await enrichIssue({
          adapter: llmAdapter,
          akbAdapter: akb.adapter,
          ...(githubAdapter ? { githubAdapter } : {}),
          request: runRequest.input,
          authoringLanguage,
          onEvent: (event) => {
            if (!signal.aborted) writeEvent(event);
          },
        });
      },
    );
  }

  return localizedAgentError(
    "agent.runRequestInvalid",
    400,
    "unsupported_agent_task",
  );
}
