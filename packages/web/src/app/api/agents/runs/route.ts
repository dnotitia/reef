import { extractVault } from "@/lib/akb/extractVault";
import { localizedAgentError } from "@/lib/api/errorLocalization";
import { getAkbAdapter, getAkbCurrentActor } from "@/lib/api/requestHelpers";
import { resolveGroundingGitHubAdapter } from "@/lib/github/resolveGroundingGitHubAdapter";
import { resolveScanGitHubAdapter } from "@/lib/github/resolveScanGitHubAdapter";
import {
  ServerLlmConfigError,
  createServerLlmAdapter,
  getRequiredServerLlmConfig,
} from "@/lib/llm/serverConfig";
import { logger } from "@/lib/logging/logger";
import {
  AgentRunRequestSchema,
  AuthError,
  type GitHubAdapter,
  akbReadAuthoringLanguage,
  createWorkspaceChatAgentResponse,
  describeError,
  enrichIssue,
  scanAndPersistActivitySuggestions,
} from "@reef/core";
import type { UIMessage } from "ai";
import {
  createAgentEventStream,
  createChatRunEventBridge,
  createTopLevelRunEmitter,
  drainResponseBody,
} from "./stream";

/**
 * POST /api/agents/runs — unified agent runtime entrypoint.
 *
 * Accepts `{ task_id, input }`, validates task-specific input through
 * `AgentRunRequestSchema`, invokes the matching core task, and streams typed
 * `AgentRunEvent` SSE frames. Existing feature routes remain as compat
 * wrappers; this route is the common contract for framework-driven runs.
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
      { validation: parsed.error.flatten() },
    );
  }
  const runRequest = parsed.data;

  const akb = getAkbAdapter(request);
  if ("response" in akb) {
    const authResponse = await akb.response;
    if (authResponse.headers.has("set-cookie")) return authResponse;
    return localizedAgentError(
      "agent.workspaceAuthRequired",
      401,
      "workspace_auth_required",
    );
  }

  // Chat and enrichment open an SSE response before their first AKB data read.
  // Verify the account while response headers are still mutable so a removed or
  // suspended member cannot reach a model step and receives the session-clearing
  // cookies from the shared AKB account boundary. Activity scan already performs
  // the same preflight through resolveScanGitHubAdapter before opening its stream.
  if (
    runRequest.task_id === "chat.workspace" ||
    runRequest.task_id === "issue.enrichment"
  ) {
    const account = await getAkbCurrentActor(request);
    if ("response" in account) return account.response;
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
          await drainResponseBody(
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

  const { owner, repo, vault, since, projectPrefix } = runRequest.input;
  // Same credential selection as POST /api/activity/scan: deployment-managed
  // GitHub App just (REEF-244). Resolved before the stream opens, so a
  // credential failure surfaces as a structured agent error rather than
  // mid-stream.
  const github = await resolveScanGitHubAdapter(request);
  if (github.kind === "session_invalid") {
    // Account denials carry localized copy and session-clearing cookies from the
    // shared AKB boundary. Returning that response intact is the only way to
    // preserve both. Plain 401 and backend failures retain the structured agent
    // error contract below.
    if (github.response.headers.has("set-cookie")) return github.response;

    const status = github.response.status;
    return status === 401
      ? localizedAgentError(
          "agent.workspaceAuthRequired",
          401,
          "workspace_auth_required",
        )
      : localizedAgentError(
          "agent.workspaceUnavailable",
          status,
          "workspace_unavailable",
        );
  }
  if (github.kind === "github_app_unconfigured") {
    return localizedAgentError(
      "githubAppUnconfigured",
      503,
      "github_unavailable",
    );
  }
  if (github.kind === "github_error") {
    logger.error(
      { err: github.error, owner, repo, vault },
      "activity_scan_agent_run github credential failed",
    );
    // Keep the structured agent-error contract the rest of this route uses,
    // mapping the GitHub mint failure through the same status ladder as the
    // manual scan route (describeError) so a revoked/rate-limited App is
    // reported with the right status and recoverable flag.
    return localizedAgentError(
      "agent.githubCredentialUnavailable",
      describeError(github.error).status,
      "github_unavailable",
    );
  }
  const githubAdapter = github.adapter;
  return createAgentEventStream(
    "activity.scan",
    request.signal,
    async (writeEvent, signal) => {
      const activityRun = createTopLevelRunEmitter("activity.scan", writeEvent);
      activityRun.started({
        owner,
        repo,
        vault,
        since,
        projectPrefix,
      });

      try {
        if (signal.aborted) {
          activityRun.cancelled("aborted");
          return;
        }
        const result = await scanAndPersistActivitySuggestions({
          adapter: githubAdapter,
          akbAdapter: akb.adapter,
          vault,
          llmAdapter,
          owner,
          repo,
          ...(since ? { since } : {}),
          projectPrefix,
          onEvent: (event) => {
            if (!signal.aborted) activityRun.childEvent(event);
          },
          isAborted: () => signal.aborted,
        });
        if (result.status === "aborted") {
          activityRun.cancelled("aborted");
          return;
        }
        const artifactCount =
          result.drafts.length + result.statusChanges.length;
        if (artifactCount > 0) {
          activityRun.completed({
            draft_count: result.drafts.length,
            status_change_count: result.statusChanges.length,
            persisted_suggestion_count: result.persistedSuggestions.length,
          });
        } else {
          activityRun.empty("No activity suggestions were produced.");
        }
      } catch (err) {
        if (signal.aborted) {
          activityRun.cancelled("aborted");
          return;
        }
        activityRun.error(err);
        logger.error(
          { err, owner, repo, vault },
          "activity_scan_agent_run_failed",
        );
      }
    },
  );
}
