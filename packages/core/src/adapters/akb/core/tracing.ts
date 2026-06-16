import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("@reef/core");

type SpanAttributeValue = string | number | boolean;
type SpanAttributes = Record<string, SpanAttributeValue | undefined>;

/**
 * Wraps a handler in a tracer span with consistent error recording, status,
 * and span.end(). Initial attributes are set before invocation; the handler
 * receives the span so it can record runtime values (e.g. result counts).
 */
export function withSpan<T>(
  name: string,
  attributes: SpanAttributes,
  handler: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        span.setAttribute(key, value);
      }
    }
    try {
      return await handler(span);
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
