import { extractVault } from "@/lib/akb/extractVault";
import { getAkbAdapter } from "@/lib/api/requestHelpers";
import { extractGithubToken } from "@/lib/github/extractGithubToken";
import { resolveScanGitHubAdapter } from "@/lib/github/resolveScanGitHubAdapter";
import {
  ServerLlmConfigError,
  getRequiredServerLlmConfig,
} from "@/lib/llm/serverConfig";
import { logger } from "@/lib/logging/logger";
import {
  AgentRunRequestSchema,
  AuthError,
  akbReadAuthoringLanguage,
  createGitHubAdapter,
  createLlmAdapter,
  createWorkspaceChatAgentResponse,
  enrichIssue,
  scanAndPersistActivitySuggestions,
  translateError,
} from "@reef/core";
import type { UIMessage } from "ai";
import {
  createAgentEventStream,
  createChatRunEventBridge,
  createTopLevelRunEmitter,
  drainResponseBody,
  jsonAgentError,
} from "./stream";

const BAD_BODY_MESSAGE = "Agent run request is missing or invalid.";
const BAD_AKB_AUTH_MESSAGE = "Workspace session is missing or invalid.";
const BAD_AKB_BACKEND_MESSAGE =
  "Workspace backend is unavailable. Please try again.";
const BAD_GITHUB_AUTH_MESSAGE =
  "Reconnect GitHub in Settings to run this agent task.";
const BAD_GITHUB_CREDENTIAL_MESSAGE =
  "GitHub App credentials are unavailable. Check the deployment GitHub App configuration.";
const BAD_VAULT_MESSAGE = "X-Reef-Vault header is missing or invalid.";
const UNAVAILABLE_MESSAGE =
  "AI service is unavailable for this deployment. Please contact an administrator.";

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
    return jsonAgentError(BAD_BODY_MESSAGE, 400, "invalid_json_body");
  }

  const parsed = AgentRunRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonAgentError(BAD_BODY_MESSAGE, 400, "invalid_agent_run_request", {
      validation: parsed.error.flatten(),
    });
  }
  const runRequest = parsed.data;

  const akb = getAkbAdapter(request);
  if ("response" in akb) {
    return jsonAgentError(BAD_AKB_AUTH_MESSAGE, 401, "workspace_auth_required");
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
    return jsonAgentError(UNAVAILABLE_MESSAGE, 503, "llm_unavailable");
  }

  const llmAdapter = createLlmAdapter({
    apiKey: llmConfig.api_key,
    baseUrl: llmConfig.base_url,
    model: llmConfig.model,
  });

  if (runRequest.task_id === "chat.workspace") {
    let githubToken: string | undefined;
    let vault: string;
    try {
      githubToken = extractOptionalGithubToken(request);
    } catch (err) {
      if (err instanceof AuthError) {
        return jsonAgentError(
          BAD_GITHUB_AUTH_MESSAGE,
          401,
          "github_auth_required",
        );
      }
      throw err;
    }
    try {
      vault = extractVault(request);
    } catch (err) {
      if (err instanceof AuthError) {
        return jsonAgentError(BAD_VAULT_MESSAGE, 401, "vault_required");
      }
      throw err;
    }

    const githubAdapter = githubToken
      ? createGitHubAdapter({ token: githubToken })
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
    let githubAdapter: ReturnType<typeof createGitHubAdapter> | undefined;
    if (runRequest.input.repoContext) {
      try {
        githubAdapter = createGitHubAdapter({
          token: extractGithubToken(request),
        });
      } catch (err) {
        if (!(err instanceof AuthError)) {
          logger.error(
            {
              err,
              task_id: runRequest.task_id,
              issue_id: runRequest.input.issueId,
            },
            "agent_run_enrichment_github_token_error",
          );
        }
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
  // Same credential selection as POST /api/activity/scan: server-managed GitHub
  // App when the deployment is configured, browser PAT fallback otherwise
  // (REEF-240 AC2). Resolved before the stream opens, so a credential failure
  // surfaces as a structured agent error rather than mid-stream.
  const github = await resolveScanGitHubAdapter(request);
  if (github.kind === "session_invalid") {
    // The resolver surfaces getAkbCurrentActor's response, which is 401 for a
    // bad/expired session but 5xx when the akb backend itself is unreachable.
    // Preserve that status — and its recoverable semantics — instead of
    // flattening a backend outage into a non-recoverable auth error.
    const status = github.response.status;
    return status === 401
      ? jsonAgentError(BAD_AKB_AUTH_MESSAGE, 401, "workspace_auth_required")
      : jsonAgentError(
          BAD_AKB_BACKEND_MESSAGE,
          status,
          "workspace_unavailable",
        );
  }
  if (github.kind === "github_auth_required") {
    return jsonAgentError(BAD_GITHUB_AUTH_MESSAGE, 401, "github_auth_required");
  }
  if (github.kind === "github_error") {
    logger.error(
      { err: github.error, owner, repo, vault },
      "activity_scan_agent_run github credential failed",
    );
    // Keep the structured agent-error contract the rest of this route uses,
    // mapping the GitHub mint failure through the same status ladder as the
    // manual scan route (translateError) so a revoked/rate-limited App is
    // reported with the right status and recoverable flag.
    return jsonAgentError(
      BAD_GITHUB_CREDENTIAL_MESSAGE,
      translateError(github.error).status,
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

function extractOptionalGithubToken(request: Request): string | undefined {
  if (!request.headers.get("authorization")) return undefined;
  return extractGithubToken(request);
}
