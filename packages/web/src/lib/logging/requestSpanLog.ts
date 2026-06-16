import type { tracing } from "@opentelemetry/sdk-node";

// IMPORTANT: do NOT import the shared pino `logger` at module load. This module
// is imported by `instrumentation-node.ts` to register RequestLogSpanProcessor,
// and that import runs BEFORE `sdk.start()` registers PinoInstrumentation.
// PinoInstrumentation patches loggers created by `pino()` calls AFTER it
// installs its module hook, so eagerly constructing the singleton here would
// leave it un-patched and strip `trace_id`/`span_id` from every backend log
// (the REEF-235 invariant: the SDK starts before anything imports the logger).
// The logger is therefore loaded lazily, on first use, well after `sdk.start()`.

/**
 * Response-phase request logging via OpenTelemetry.
 *
 * The Edge `proxy.ts` logs each request on the way IN (method, path, query) but
 * runs BEFORE the Route Handler, so it does not see the response status or the
 * full request duration. Next.js wraps every request in an OpenTelemetry span
 * (`next.span_type === "BaseServer.handleRequest"`) that closes once the
 * response is committed, carrying `http.status_code` and timing. This span
 * processor turns that root request span into a single structured completion
 * log — emitted through the shared pino `logger`, so it is pretty in dev and
 * JSON in prod, correlated by `trace_id` to the inbound `proxy.ts` line.
 *
 * It reads just span metadata (method, route, status, duration); it does not
 * touches request/response headers or bodies, so no credential can reach the
 * log. Scope is limited to `/api/*` to mirror the proxy's request log and avoid
 * a line per static page navigation.
 */

/** Next.js span type for the root per-request span. */
const ROOT_REQUEST_SPAN_TYPE = "BaseServer.handleRequest";

export interface RequestCompletionLog {
  method: string;
  route: string;
  status: number;
  duration_ms: number;
  trace_id: string;
}

/** HrTime (`[seconds, nanoseconds]`) → milliseconds, rounded to 0.1 ms. */
function hrTimeToMs(hr: tracing.ReadableSpan["duration"]): number {
  return Math.round((hr[0] * 1e3 + hr[1] / 1e6) * 10) / 10;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Project a finished span to a request-completion record, or `null` if it is
 * not the matched `/api/*` route request span. Pure and exported for unit
 * testing.
 *
 * Next.js emits TWO `BaseServer.handleRequest` spans per request: an outer one
 * (name the method, no `http.route`, status 200 from the proxy's
 * `NextResponse.next()`) and the inner matched-route span that carries
 * `http.route` and the true response status. Requiring `http.route` both scopes
 * to real routes and dedupes to a single line per request.
 */
export function requestCompletionFromSpan(
  span: tracing.ReadableSpan,
): RequestCompletionLog | null {
  const attrs = span.attributes;
  if (attrs["next.span_type"] !== ROOT_REQUEST_SPAN_TYPE) {
    return null;
  }

  const route = asString(attrs["http.route"]);
  if (!route || !route.startsWith("/api/")) {
    return null;
  }

  const statusAttr = attrs["http.status_code"];
  const status =
    typeof statusAttr === "number" ? statusAttr : Number(statusAttr ?? 0);

  return {
    method: asString(attrs["http.method"]) ?? "",
    route,
    status,
    duration_ms: hrTimeToMs(span.duration),
    trace_id: span.spanContext().traceId,
  };
}

/**
 * Whether to register the response-completion access log (dev/deploy split).
 *
 * Development just by default: locally, a `response` line on stdout is the
 * fastest way to see status + duration next to the inbound `request` line. In
 * production we lean on the standard logs/traces separation — status and timing
 * live in the exported OpenTelemetry spans (viewed in the trace backend) and are
 * correlated to the inbound `request` log by `trace_id`, so we do NOT synthesize
 * a log line from a span there. Set `REEF_RESPONSE_LOG=1` to opt into the stdout
 * access log in any environment (e.g. a deployment with no trace backend).
 *
 * Pure and exported so the dev/deploy branch is unit-testable without booting
 * the OpenTelemetry SDK (mirrors `buildLoggerOptions` in logger.ts).
 */
export function responseLoggingEnabled(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return nodeEnv === "development" || process.env.REEF_RESPONSE_LOG === "1";
}

/**
 * SpanProcessor that emits one completion line per `/api/*` request span. The
 * other lifecycle hooks are no-ops — export/batching is owned by the separate
 * OTLP processor wired alongside this one in `instrumentation-node.ts`.
 */
export class RequestLogSpanProcessor implements tracing.SpanProcessor {
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  onStart(): void {}

  onEnd(span: tracing.ReadableSpan): void {
    // Fire-and-forget: a span processor should not block or throw.
    void this.logResponse(span);
  }

  /**
   * Emit the response-completion line for a request span. The shared logger is
   * imported lazily here (see the module note) so registering this processor
   * does not constructs the logger before instrumentation patches pino. Returns the
   * in-flight promise: `onEnd` fires it and forgets; tests await it.
   */
  async logResponse(span: tracing.ReadableSpan): Promise<void> {
    const record = requestCompletionFromSpan(span);
    if (!record) {
      return;
    }
    try {
      const { logger } = await import("@/lib/logging/logger");
      logger.info(record, "response");
    } catch {
      // Logging should not surface an error from a span processor.
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
