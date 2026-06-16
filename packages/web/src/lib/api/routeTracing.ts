import { tracer } from "@/lib/telemetry";
import { SpanStatusCode } from "@opentelemetry/api";

type RouteSpanAttribute = string | number | boolean | undefined | null;

export async function runRouteSpan<T>({
  name,
  attributes,
  run,
}: {
  name: string;
  attributes?: Record<string, RouteSpanAttribute>;
  run: () => Promise<T>;
}): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    for (const [key, value] of Object.entries(attributes ?? {})) {
      if (value !== undefined && value !== null) span.setAttribute(key, value);
    }
    try {
      return await run();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
