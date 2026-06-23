import { createOpenAI } from "@ai-sdk/openai";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  type LanguageModel,
  generateText as aiGenerateText,
  streamText as aiStreamText,
} from "ai";
import { LlmError } from "../errors";
import { observe } from "../observability";
import { extractErrorDetail } from "../utils/extractErrorDetail";

const tracer = trace.getTracer("@reef/core");

export interface CreateLlmAdapterParams {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface LlmAdapter {
  /**
   * Returns the resolved AI SDK language model instance.
   * Created fresh on each call — no module-level singleton.
   */
  model(): LanguageModel;

  /**
   * Thin wrapper over AI SDK `streamText`.
   *
   * IMPORTANT: `streamText` returns a `StreamTextResult` synchronously (NOT a
   * Promise). Do NOT await the result. The span lifecycle is managed via
   * `onFinish`/`onError` callbacks because the stream is still open when the
   * synchronous call returns.
   *
   * NOTE: Any `model` field supplied in `options` is **overridden** by the
   * adapter's own `model()` call. Credentials are scoped to this adapter
   * instance. Callers should omit `model` from options or use
   * `adapter.model()` explicitly when calling AI SDK functions directly (as
   * `route.ts` does for the streaming path to avoid double-wrapping the span
   * lifecycle).
   */
  streamText: typeof aiStreamText;

  /**
   * Thin async wrapper over AI SDK `generateText`.
   * Wraps the call in an OTEL span with proper try/catch/finally hygiene.
   *
   * NOTE: Any `model` field supplied in `options` is **overridden** by the
   * adapter's own `model()` call. See `streamText` note above.
   */
  generateText: typeof aiGenerateText;
}

/**
 * Factory function — per-request LLM adapter.
 *
 * Creates a new adapter instance for each HTTP request. The underlying
 * `createOpenAI` client is constructed lazily inside `model()` so that
 * credentials does not escape into module scope.
 */
export function createLlmAdapter(params: CreateLlmAdapterParams): LlmAdapter {
  const { apiKey, baseUrl, model: modelId } = params;

  function model(): LanguageModel {
    // Constructed fresh each call — credentials scoped to this call frame.
    const openai = createOpenAI({ apiKey, baseURL: baseUrl });
    return openai(modelId);
  }

  function streamText(
    ...args: Parameters<typeof aiStreamText>
  ): ReturnType<typeof aiStreamText> {
    const [options] = args;
    const span = tracer.startSpan("reef.streamText", {
      attributes: { "llm.model": modelId },
    });
    try {
      const result = aiStreamText({
        ...options,
        model: model(),
        experimental_telemetry: {
          isEnabled: true,
          functionId: "reef.streamText",
          ...((options as { experimental_telemetry?: object })
            .experimental_telemetry ?? {}),
        },
        onFinish: (finishResult) => {
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          if (options.onFinish) {
            options.onFinish(finishResult);
          }
        },
        onError: ({ error }) => {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          span.end();
          if (options.onError) {
            options.onError({ error });
          }
        },
      });
      return result;
    } catch (err) {
      const detail = extractErrorDetail(err);
      const error = err instanceof Error ? err : new Error(detail);
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: detail });
      span.end();
      throw new LlmError({ message: detail });
    }
  }

  async function generateText(
    ...args: Parameters<typeof aiGenerateText>
  ): Promise<Awaited<ReturnType<typeof aiGenerateText>>> {
    const [options] = args;
    return tracer.startActiveSpan("reef.generateText", async (span) => {
      span.setAttribute("llm.model", modelId);
      try {
        const result = await aiGenerateText({
          ...options,
          model: model(),
          experimental_telemetry: {
            isEnabled: true,
            functionId: "reef.generateText",
            ...((options as { experimental_telemetry?: object })
              .experimental_telemetry ?? {}),
          },
        });
        // Capture token usage + finish reason (REEF-271). The wrapper previously
        // recorded only `llm.model` and discarded `result.usage`, leaving the
        // scan path's LLM cost invisible while `enrichIssue` already captured it
        // (an asymmetry). `observe` puts the same fields on the span (prod cost/
        // usage dashboards) AND, when wired, one dev stdout line per call.
        observe(
          span,
          {
            "llm.model": modelId,
            "llm.usage.prompt_tokens": result.usage?.inputTokens,
            "llm.usage.completion_tokens": result.usage?.outputTokens,
            "llm.finish_reason": result.finishReason ?? "unknown",
          },
          "llm.generateText",
        );
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        const detail = extractErrorDetail(err);
        const error = err instanceof Error ? err : new Error(detail);
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: detail });
        throw new LlmError({ message: detail });
      } finally {
        span.end();
      }
    });
  }

  return {
    model,
    streamText: streamText as typeof aiStreamText,
    generateText: generateText as typeof aiGenerateText,
  };
}
