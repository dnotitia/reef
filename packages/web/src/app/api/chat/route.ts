import { localizedErrorResponse } from "@/lib/api/errorLocalization";
import { agentLoopStepsTotal, toolCallsTotal } from "@/lib/metrics";
import { ChatRequestBodySchema } from "@/lib/schemas/llmConfig";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  AuthError,
  createLlmAdapter,
  createWorkspaceChatAgentResponse,
  getWorkspaceChatTaskConfig,
} from "@reef/core";
import type { UIMessage } from "ai";
import { extractVault } from "../../../lib/akb/extractVault";
import { getAkbAdapter } from "../../../lib/api/requestHelpers";
import { resolveGroundingGitHubAdapter } from "../../../lib/github/resolveGroundingGitHubAdapter";
import {
  ServerLlmConfigError,
  getRequiredServerLlmConfig,
} from "../../../lib/llm/serverConfig";
import { logger } from "../../../lib/logging/logger";

const tracer = trace.getTracer("reef-web");

/**
 * POST /api/chat — multi-step agent loop endpoint.
 *
 * Bridge endpoint superseded by `POST /api/agents/runs`
 * (`task_id: "chat.workspace"`), which runs the same core chat agent but streams
 * agent-run SSE events (including tool-call transparency frames). The Ask AI
 * client migrated off this route in REEF-361; `web` has no client caller. It
 * remains until the metrics/schema wiring can be removed in a follow-up.
 *
 * Wires the read reef chat task via `chat.workspace`:
 *   • vault reads (`read_issue`, `search_issues`, `list_assignees`) — akb
 *   • monitored-repo grounding (`search_code`, `dev_read_file`) — GitHub, via
 *     the deployment GitHub App (`resolveGroundingGitHubAdapter`). When the
 *     App is unavailable, chat degrades to AKB scoped grounding (REEF-243 /
 *     REEF-244).
 *
 * No vault-mutating tools are wired here — the chat loop is read
 * grounding; mutations go through dedicated Route Handlers.
 *
 * Per-user state rides in headers and cookies — does not persisted.
 *   - `__reef_session` httpOnly cookie (akb JWT)
 *   - `X-Reef-Vault: <vault_name>` (active vault identifier)
 * The GitHub App credential and the LLM credentials are deployment-managed
 * server state; both adapter instances fall out of scope when this handler
 * returns.
 *
 * Reverse-proxy deployment requirement: `proxy_buffering off;` keeps SSE
 * delivery unbuffered for this route.
 */
export async function POST(request: Request): Promise<Response> {
  let config: ReturnType<typeof getRequiredServerLlmConfig>;
  try {
    config = getRequiredServerLlmConfig();
  } catch (err) {
    if (err instanceof ServerLlmConfigError) {
      return localizedErrorResponse("aiUnavailableDeployment", 503);
    }
    return localizedErrorResponse("aiUnavailableDeployment", 503);
  }

  let vault: string;
  try {
    vault = extractVault(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return localizedErrorResponse("vaultHeaderInvalid", 401);
    }
    return localizedErrorResponse("vaultHeaderInvalid", 400);
  }

  const akbResult = getAkbAdapter(request);
  if ("response" in akbResult) return akbResult.response;
  const akbAdapter = akbResult.adapter;

  let body: {
    messages: UIMessage[];
    route: string | null;
    reefId: string | null;
  };
  try {
    const rawBody: unknown = await request.json();
    const bodyResult = ChatRequestBodySchema.safeParse(rawBody);
    if (!bodyResult.success) {
      return localizedErrorResponse("requestBodyInvalid", 400);
    }
    body = {
      messages: bodyResult.data.messages as UIMessage[],
      // Grounding hints: the route the PM is on and the open issue's id, when
      // sent. Core assembles them into the chat system prompt (REEF-360).
      route: bodyResult.data.route ?? null,
      reefId: bodyResult.data.reefId ?? null,
    };
  } catch {
    return localizedErrorResponse("requestBodyInvalid", 400);
  }

  const llmAdapter = createLlmAdapter({
    apiKey: config.api_key,
    baseUrl: config.base_url,
    model: config.model,
  });

  // Server-managed GitHub App just. Any failure to obtain a GitHub adapter
  // degrades to AKB scoped grounding (REEF-243 / REEF-244); the credential does not
  // reaches the response or the LLM prompt.
  const githubResolution = await resolveGroundingGitHubAdapter(request);
  if (githubResolution.kind === "degraded" && githubResolution.error) {
    logger.warn(
      { err: githubResolution.error, vault },
      "chat_grounding_github_app_unavailable",
    );
  }
  const githubAdapter =
    githubResolution.kind === "adapter" ? githubResolution.adapter : undefined;

  const chatTaskConfig = getWorkspaceChatTaskConfig();

  const span = tracer.startSpan("chat.agentLoop", {
    attributes: {
      "llm.model": config.model,
      "llm.message_count": body.messages.length,
      "agent.task_id": chatTaskConfig.taskId,
      "agent.max_steps": chatTaskConfig.maxSteps ?? undefined,
      vault,
    },
  });

  let spanClosed = false;
  const closeSpan = (ok: boolean, message?: string) => {
    if (spanClosed) return;
    spanClosed = true;
    span.setStatus(
      ok
        ? { code: SpanStatusCode.OK }
        : { code: SpanStatusCode.ERROR, message: message ?? "stream error" },
    );
    span.end();
  };

  try {
    return await createWorkspaceChatAgentResponse({
      adapter: akbAdapter,
      ...(githubAdapter ? { githubAdapter } : {}),
      vault,
      llmAdapter,
      messages: body.messages,
      route: body.route,
      currentIssueId: body.reefId,
      onStepFinish: ({ stepIndex, finishReason, toolNames }) => {
        span.setAttribute(`step.${stepIndex}.finish_reason`, finishReason);
        if (toolNames.length > 0) {
          span.setAttribute(`step.${stepIndex}.tools`, toolNames.join(","));
        }
        agentLoopStepsTotal.inc();
        for (const toolName of toolNames) {
          toolCallsTotal.inc({ tool_name: toolName });
        }
      },
      onFinish: () => {
        closeSpan(true);
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : "stream error";
        closeSpan(false, message);
        return message;
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    span.recordException(error);
    closeSpan(false, error.message);
    throw err;
  }
}
