import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { AkbAdapter } from "../adapters/akb";
import type { GitHubAdapter } from "../adapters/github";
import type { LlmAdapter } from "../adapters/llm";
import { LlmError, SchemaValidationError } from "../errors";
import type {
  EnrichmentRequest,
  EnrichmentResult,
} from "../schemas/ai/enrichment";
import { extractErrorDetail } from "../utils/extractErrorDetail";
import { WorkspaceBoundaryError } from "./enrichIssue/context";
import {
  buildIssueEnrichmentStageHandlers,
  createIssueEnrichmentState,
} from "./enrichIssue/stageHandlers";
import { parseEnrichmentResult } from "./enrichIssue/validation";
import type { AgentRunEvent } from "./framework/events";
import { createAgentTaskFromRegistry } from "./framework/registry";
import { collectAgentResult, runAgentStream } from "./framework/runtime";

const tracer = trace.getTracer("@reef/core");

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
  onEvent?: (event: AgentRunEvent) => void | Promise<void>;
}

type EnrichIssueEventSink = NonNullable<EnrichIssueParams["onEvent"]>;

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

    try {
      const state = createIssueEnrichmentState(params);
      const task = createAgentTaskFromRegistry("issue.enrichment", {
        initial_state: state,
        stageHandlers: buildIssueEnrichmentStageHandlers(span),
        metadata: {
          issue_id: request.issueId,
          vault: request.vault,
          repo: request.repoContext
            ? `${request.repoContext.owner}/${request.repoContext.repo}`
            : null,
        },
      });

      const envelope = await collectAgentResult(
        tapAgentEvents(
          runAgentStream(task, {
            metadata: {
              issue_id: request.issueId,
              vault: request.vault,
            },
          }),
          params.onEvent,
        ),
      );
      span.setAttribute("enrichment.run_status", envelope.status);
      if (envelope.status === "error") {
        throw (
          state.error ??
          new LlmError({
            message: envelope.error?.message ?? "Issue enrichment task failed.",
          })
        );
      }
      span.setStatus({ code: SpanStatusCode.OK });
      return (
        state.result ??
        parseEnrichmentResult({ suggestions: [], references: [] })
      );
    } catch (err) {
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

async function* tapAgentEvents(
  events: AsyncIterable<AgentRunEvent>,
  onEvent?: EnrichIssueEventSink,
): AsyncGenerator<AgentRunEvent> {
  for await (const event of events) {
    await onEvent?.(event);
    yield event;
  }
}

export {
  parseEnrichmentResponse,
  validateSuggestions,
} from "./enrichIssue/validation";
