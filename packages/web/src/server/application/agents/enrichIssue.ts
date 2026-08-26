import type { GitHubAdapter } from "@/server/adapters/githubAdapter";
import type { LlmAdapter } from "@/server/adapters/llmAdapter";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { AkbAdapter } from "@reef/core";
import { LlmError, SchemaValidationError } from "@reef/core";
import type { EnrichmentRequest, EnrichmentResult } from "@reef/core";
import { extractErrorDetail } from "@reef/core";
import { WorkspaceBoundaryError } from "./enrichIssue/context";
import {
  createIssueEnrichmentState,
  runIssueEnrichmentPipeline,
} from "./enrichIssue/pipeline";
import type { AgentRunEvent } from "./framework/events";
import { createAgentRunLifecycle } from "./framework/lifecycle";

const tracer = trace.getTracer("@reef/web");

export interface EnrichIssueParams {
  adapter: LlmAdapter;
  akbAdapter?: AkbAdapter;
  githubAdapter?: GitHubAdapter;
  request: EnrichmentRequest;
  /**
   * Workspace default authoring language (REEF-136). When set, enrichment
   * suggestions are written in it; the route reads it from config and passes it.
   * undefined/null preserves the prior model-default behavior.
   */
  authoringLanguage?: string | null;
  onEvent?: (event: AgentRunEvent) => void;
}

/**
 * AI-assisted issue enrichment (Motivation 2 — non-PM author gets a
 * professionalized issue).
 *
 * Runs a bounded tool-loop (`generateText` with `tools` + `stopWhen`). The
 * server injects AKB workspace context up front; tools are reserved for detail
 * checks such as reading a template body, verifying issue relations, or
 * inspecting code in a monitored GitHub repo.
 *
 * Each suggestion is validated against `EnrichmentSuggestionSchema`; any
 * that fail validation (wrong enum value, malformed shape, dependency on
 * an unknown issue id) are dropped rather than failing the whole call —
 * the UI degrades gracefully and shows whatever the model got right.
 *
 * Throws `LlmError` if the model is unreachable or returns unparseable
 * output. The caller (route handler) maps this to an HTTP 502/503 with a
 * PM-vocabulary message so the dialog can show the unavailable state.
 */
export async function enrichIssue(
  params: EnrichIssueParams,
): Promise<EnrichmentResult> {
  return tracer.startActiveSpan("reef.enrich_issue", async (span) => {
    const { request } = params;
    span.setAttribute("enrichment.issue_id", request.issueId);
    span.setAttribute("enrichment.vault", request.vault);
    span.setAttribute(
      "enrichment.repo",
      request.repoContext
        ? `${request.repoContext.owner}/${request.repoContext.repo}`
        : "none",
    );
    const lifecycle = createAgentRunLifecycle({
      taskId: "issue.enrichment",
      metadata: { function_id: "reef.agent.issue.enrichment" },
      onEvent: params.onEvent,
    });

    try {
      const state = createIssueEnrichmentState(params);
      lifecycle.start({
        issue_id: request.issueId,
        vault: request.vault,
      });
      const pipeline = await runIssueEnrichmentPipeline({
        state,
        span,
        lifecycle,
      });
      const hasResult =
        pipeline.result.suggestions.length > 0 ||
        pipeline.result.references.length > 0;
      if (hasResult) {
        lifecycle.complete({
          artifactIds: pipeline.artifactId ? [pipeline.artifactId] : [],
          usage: pipeline.usage,
          metadata: pipeline.finishReason
            ? { finish_reason: pipeline.finishReason }
            : {},
        });
      } else {
        lifecycle.empty(pipeline.finishReason);
      }
      span.setAttribute(
        "enrichment.run_status",
        hasResult ? "completed" : "empty",
      );
      span.setStatus({ code: SpanStatusCode.OK });
      return pipeline.result;
    } catch (err) {
      lifecycle.fail(err, "issue_enrichment_failed");
      const workspaceBoundaryCause =
        err instanceof WorkspaceBoundaryError ? err.boundaryCause : null;
      const detail =
        err instanceof LlmError
          ? err.context.message
          : workspaceBoundaryCause
            ? extractErrorDetail(workspaceBoundaryCause)
            : extractErrorDetail(err);
      const error = workspaceBoundaryCause
        ? workspaceBoundaryCause
        : err instanceof Error
          ? err
          : new Error(detail);
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: detail });
      if (workspaceBoundaryCause) {
        throw workspaceBoundaryCause;
      }
      if (err instanceof LlmError || err instanceof SchemaValidationError) {
        throw err;
      }
      throw new LlmError({ message: detail });
    } finally {
      span.end();
    }
  });
}

export {
  parseEnrichmentResponse,
  validateSuggestions,
} from "./enrichIssue/validation";
