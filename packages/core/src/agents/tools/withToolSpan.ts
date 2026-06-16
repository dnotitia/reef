import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("@reef/core");

/**
 * Wraps an AI SDK tool's `execute` body in a uniform OpenTelemetry span shell:
 * start → optional attribute setter → run → OK / record-exception-and-rethrow
 * → end. Keeps each tool focused on its real work and gives every reef tool
 * the same trace shape (`reef.tool.<name>`).
 */
export function withToolSpan<Input, Output>(
  name: string,
  input: Input,
  attributes: ((span: Span, input: Input) => void) | null,
  execute: (span: Span) => Promise<Output>,
): Promise<Output> {
  return tracer.startActiveSpan(name, async (span) => {
    attributes?.(span, input);
    try {
      const result = await execute(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw err;
    } finally {
      span.end();
    }
  });
}
