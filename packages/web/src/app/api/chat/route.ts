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

const UNAVAILABLE_MESSAGE =
  "AI service is unavailable for this deployment. Please contact an administrator.";
const BAD_VAULT_MESSAGE = "X-Reef-Vault header is missing or invalid";
const BAD_BODY_MESSAGE = "Request body is missing or invalid";

/**
 * POST /api/chat — multi-step agent loop endpoint.
 *
 * Wires the read reef chat task via `chat.workspace`:
 *   • vault reads (`read_issue`, `search_issues`, `list_assignees`) — akb
 *   • monitored-repo grounding (`search_code`, `dev_read_file`) — GitHub, via
 *     the deployment GitHub App (`resolveGroundingGitHubAdapter`). When the
 *     App is unavailable, chat degrades to AKB-only grounding (REEF-243 /
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
 * Reverse-proxy deployment requirement: `proxy_buffering off;` is mandatory
 * for this route so SSE delivery is not buffered.
 */
export async function POST(request: Request): Promise<Response> {
  let config: ReturnType<typeof getRequiredServerLlmConfig>;
  try {
    config = getRequiredServerLlmConfig();
  } catch (err) {
    if (err instanceof ServerLlmConfigError) {
      return jsonError(UNAVAILABLE_MESSAGE, 503);
    }
    return jsonError(UNAVAILABLE_MESSAGE, 503);
  }

  let vault: string;
  try {
    vault = extractVault(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(BAD_VAULT_MESSAGE, 401);
    }
    return jsonError(BAD_VAULT_MESSAGE, 400);
  }

  const akbResult = getAkbAdapter(request);
  if ("response" in akbResult) return akbResult.response;
  const akbAdapter = akbResult.adapter;

  let body: { messages: UIMessage[] };
  try {
    const rawBody: unknown = await request.json();
    const bodyResult = ChatRequestBodySchema.safeParse(rawBody);
    if (!bodyResult.success) {
      return jsonError(BAD_BODY_MESSAGE, 400);
    }
    body = { messages: bodyResult.data.messages as UIMessage[] };
  } catch {
    return jsonError(BAD_BODY_MESSAGE, 400);
  }

  const llmAdapter = createLlmAdapter({
    apiKey: config.api_key,
    baseUrl: config.base_url,
    model: config.model,
  });

  // Server-managed GitHub App only. Any failure to obtain a GitHub adapter
  // degrades to AKB-only grounding (REEF-243 / REEF-244); the credential never
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

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
