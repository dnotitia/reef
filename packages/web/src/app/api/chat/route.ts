import { agentLoopStepsTotal, toolCallsTotal } from "@/lib/metrics";
import { ChatRequestBodySchema } from "@/lib/schemas/llmConfig";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  AuthError,
  createGitHubAdapter,
  createLlmAdapter,
  createWorkspaceChatAgentResponse,
  getWorkspaceChatTaskConfig,
} from "@reef/core";
import type { UIMessage } from "ai";
import { extractVault } from "../../../lib/akb/extractVault";
import { getAkbAdapter } from "../../../lib/api/requestHelpers";
import { extractGithubToken } from "../../../lib/github/extractGithubToken";
import {
  ServerLlmConfigError,
  getRequiredServerLlmConfig,
} from "../../../lib/llm/serverConfig";

const tracer = trace.getTracer("reef-web");

const UNAVAILABLE_MESSAGE =
  "AI service is unavailable for this deployment. Please contact an administrator.";
const BAD_AUTH_MESSAGE = "GitHub token is missing or invalid";
const BAD_VAULT_MESSAGE = "X-Reef-Vault header is missing or invalid";
const BAD_BODY_MESSAGE = "Request body is missing or invalid";

/**
 * POST /api/chat — multi-step agent loop endpoint.
 *
 * Wires the read reef chat task via `chat.workspace`:
 *   • vault reads (`read_issue`, `search_issues`, `list_assignees`) — akb
 *   • monitored-repo grounding (`search_code`, `dev_read_file`) — GitHub,
 *     when the browser has a GitHub PAT
 *
 * No vault-mutating tools are wired here — the chat loop is read
 * grounding; mutations go through dedicated Route Handlers.
 *
 * Per-user state rides in headers and cookies — does not persisted.
 *   - `Authorization: Bearer <github_token>` (IndexedDB, optional for AKB chat)
 *   - `__reef_session` httpOnly cookie (akb JWT)
 *   - `X-Reef-Vault: <vault_name>` (active vault identifier)
 * LLM credentials are deployment-managed via `OPENROUTER_*` env vars.
 * Both adapter instances fall out of scope when this handler returns.
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

  let githubToken: string | undefined;
  try {
    githubToken = extractOptionalGithubToken(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(BAD_AUTH_MESSAGE, 401);
    }
    return jsonError(BAD_AUTH_MESSAGE, 400);
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

  const githubAdapter = githubToken
    ? createGitHubAdapter({ token: githubToken })
    : undefined;

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

function extractOptionalGithubToken(request: Request): string | undefined {
  if (!request.headers.get("authorization")) return undefined;
  return extractGithubToken(request);
}
