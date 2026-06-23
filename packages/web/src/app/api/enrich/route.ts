import { getAkbAdapter } from "@/lib/api/requestHelpers";
import { resolveGroundingGitHubAdapter } from "@/lib/github/resolveGroundingGitHubAdapter";
import { logger } from "@/lib/logging/logger";
import {
  type AgentRunEvent,
  AkbApiError,
  AuthError,
  EnrichmentRequestSchema,
  type GitHubAdapter,
  LlmError,
  NotFoundError,
  SchemaValidationError,
  akbReadAuthoringLanguage,
  createLlmAdapter,
  enrichIssue,
  translateError,
} from "@reef/core";
import {
  ServerLlmConfigError,
  getRequiredServerLlmConfig,
} from "../../../lib/llm/serverConfig";

const BAD_AKB_AUTH_MESSAGE = "Workspace session is missing or invalid";
const BAD_BODY_MESSAGE = "Request body is missing or invalid";
const UNAVAILABLE_MESSAGE =
  "AI enrichment is unavailable. You can still save the issue without it.";
const DEPLOYMENT_UNAVAILABLE_MESSAGE =
  "AI service is unavailable for this deployment. You can still save the issue without it.";
const ENRICHMENT_OUTPUT_LOG_KEYS = [
  "known_issue_count",
  "template_count",
  "system_chars",
  "user_chars",
  "tool_names",
  "response_length",
  "raw_suggestion_count",
  "needs_repair",
  "suggestion_count",
  "skipped",
] as const;

/**
 * POST /api/enrich — AI-assisted issue enrichment.
 *
 * Thin route handler around `enrichIssue` in `@reef/core`:
 *   1. Resolve deployment-managed OpenRouter config from server env (503 on failure).
 *   2. Parse + validate body against `EnrichmentRequestSchema` (400).
 *   3. Resolve the akb session cookie (401 on failure) for workspace context.
 *   4. Resolve a GitHub adapter for monitored-repo code grounding — the
 *      deployment GitHub App; any GitHub unavailability degrades to AKB scoped
 *      enrichment (REEF-243 / REEF-244).
 *   5. Build per-request adapters with credentials scoped to the call.
 *   6. Call `enrichIssue` → return `{ suggestions: [...] }`.
 *   7. `LlmError` → 503 with a PM-vocabulary message so the panel can show
 *      the unavailable state without losing the user's in-progress draft.
 */
export async function POST(request: Request): Promise<Response> {
  let config: ReturnType<typeof getRequiredServerLlmConfig>;
  try {
    config = getRequiredServerLlmConfig();
  } catch (err) {
    if (err instanceof ServerLlmConfigError) {
      return jsonError(DEPLOYMENT_UNAVAILABLE_MESSAGE, 503);
    }
    return jsonError(DEPLOYMENT_UNAVAILABLE_MESSAGE, 503);
  }

  let body: ReturnType<typeof EnrichmentRequestSchema.parse>;
  try {
    const raw: unknown = await request.json();
    const parsed = EnrichmentRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(BAD_BODY_MESSAGE, 400);
    }
    body = parsed.data;
  } catch {
    return jsonError(BAD_BODY_MESSAGE, 400);
  }

  const adapter = createLlmAdapter({
    apiKey: config.api_key,
    baseUrl: config.base_url,
    model: config.model,
  });

  const akbAdapterResult = getAkbAdapter(request);
  if ("response" in akbAdapterResult) {
    return jsonError(BAD_AKB_AUTH_MESSAGE, 401);
  }

  // Code grounding just matters when the request carries a monitored repo.
  // Server-managed GitHub App just; any failure degrades to AKB scoped enrichment
  // (REEF-243 / REEF-244) and does not surfaces the credential to the response or
  // the LLM prompt.
  let githubAdapter: GitHubAdapter | undefined;
  if (body.repoContext) {
    const githubResolution = await resolveGroundingGitHubAdapter(request);
    if (githubResolution.kind === "degraded" && githubResolution.error) {
      logger.warn(
        { err: githubResolution.error, issueId: body.issueId },
        "enrich_grounding_github_app_unavailable",
      );
    }
    if (githubResolution.kind === "adapter") {
      githubAdapter = githubResolution.adapter;
    }
  }

  try {
    const authoringLanguage = await akbReadAuthoringLanguage({
      adapter: akbAdapterResult.adapter,
      vault: body.vault,
    });
    const result = await enrichIssue({
      adapter,
      akbAdapter: akbAdapterResult.adapter,
      ...(githubAdapter ? { githubAdapter } : {}),
      request: body,
      authoringLanguage,
      onEvent: logEnrichmentEvent,
    });
    console.log(
      "[reef]",
      JSON.stringify({
        route: "POST /api/enrich",
        event: "enrich.result",
        issueId: body.issueId,
        suggestion_count: result.suggestions.length,
        timestamp: new Date().toISOString(),
      }),
    );
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof LlmError) {
      // LlmError.message is consistently the generic PM-vocabulary string. The
      // actionable detail sits on `context.message` (the underlying LLM
      // failure, JSON parse error, etc). Surface it so dev-server logs and
      // production traces can pinpoint root cause without exposing it to
      // the client.
      logger.error(
        { err, issueId: body.issueId, detail: err.context.message },
        "enrich_issue failed",
      );
      return jsonError(UNAVAILABLE_MESSAGE, 503);
    }
    if (err instanceof AuthError) {
      logger.error(
        { err, issueId: body.issueId },
        "enrich_issue workspace auth failed",
      );
      return jsonError(BAD_AKB_AUTH_MESSAGE, 401);
    }
    if (err instanceof NotFoundError) {
      logger.error(
        { err, issueId: body.issueId },
        "enrich_issue workspace not found",
      );
      return jsonError(err.toUserMessage(), 404);
    }
    if (err instanceof AkbApiError) {
      // Canonical policy (REEF-054): pass-through {401,403,404,409,422} else 502.
      // Replaces the bespoke 401|403->401 / 404->404 / else->503 ladder.
      logger.error(
        { err, issueId: body.issueId, status: err.status },
        "enrich_issue workspace backend failed",
      );
      return translateError(err);
    }
    if (err instanceof SchemaValidationError) {
      // Canonical policy (REEF-054): SchemaValidationError -> 422 (was 400).
      logger.error(
        { err, issueId: body.issueId },
        "enrich_issue invalid request context",
      );
      return translateError(err);
    }
    logger.error(
      { err, issueId: body.issueId },
      "enrich_issue unexpected error",
    );
    return jsonError("Internal error during enrichment.", 500);
  }
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function logEnrichmentEvent(event: AgentRunEvent): void {
  const summary = summarizeEnrichmentEvent(event);
  if (!summary) return;

  console.log(
    "[reef]",
    JSON.stringify({
      route: "POST /api/enrich",
      timestamp: new Date().toISOString(),
      ...summary,
    }),
  );
}

function summarizeEnrichmentEvent(
  event: AgentRunEvent,
): Record<string, unknown> | null {
  switch (event.type) {
    case "stage.completed":
      return {
        event: event.type,
        stage_id: event.stage.stage_id,
        output: pickEnrichmentOutput(event.output),
      };
    case "repair.completed":
      return {
        event: event.type,
        attempt: event.repair.attempt,
        output: pickEnrichmentOutput(event.output),
      };
    case "repair.failed":
      return {
        event: event.type,
        attempt: event.repair.attempt,
        error_code: event.error.code,
        recoverable: event.error.recoverable,
      };
    case "run.completed":
      return {
        event: event.type,
        run_status: event.run_status,
        artifact_count: event.artifact_ids.length,
      };
    case "run.empty":
      return {
        event: event.type,
        run_status: event.run_status,
        reason: event.reason,
      };
    case "run.error":
      return {
        event: event.type,
        run_status: event.run_status,
        error_code: event.error.code,
        recoverable: event.error.recoverable,
      };
    default:
      return null;
  }
}

function pickEnrichmentOutput(
  output: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const key of ENRICHMENT_OUTPUT_LOG_KEYS) {
    const value = output[key];
    if (isLoggablePrimitive(value)) {
      safe[key] = value;
    }
  }
  return safe;
}

function isLoggablePrimitive(
  value: unknown,
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}
