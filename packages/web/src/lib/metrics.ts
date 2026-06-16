import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

/**
 * Prometheus metrics singleton for reef-web.
 *
 * Uses a global registry stored on `globalThis` to survive Next.js hot-reload
 * (which re-executes module code on each reload without restarting the Node.js
 * process). Without this guard, `prom-client` would throw "A metric with that
 * name has already been registered" on the second module execution.
 *
 * The Counter instances are ALSO cached on globalThis so hot-reload returns
 * the same Counter objects rather than constructing new ones — constructing
 * a new Counter with `registers: [registry]` consistently re-registers, which would
 * throw if the registry already contains a metric with that name.
 *
 * Security invariant: no user credentials (GitHub token, LLM API key) are
 * recorded as metric labels or help text. safe identifiers (tool names,
 * conflict types) appear in label values.
 *
 * All counters are exported as named exports so Route Handlers can increment
 * them directly without importing the full registry.
 */

interface MetricsSingleton {
  registry: Registry;
  httpRequestsTotal: Counter<"method" | "route_class">;
  httpRequestDurationSeconds: Histogram<"method" | "route_class">;
  agentLoopStepsTotal: Counter<string>;
  toolCallsTotal: Counter<"tool_name">;
  casConflictsTotal: Counter<string>;
}

const globalForMetrics = globalThis as typeof globalThis & {
  __reefMetrics?: MetricsSingleton;
};

function buildMetrics(): MetricsSingleton {
  const registry = new Registry();
  // Collect default Node.js / process metrics (heap, GC, event-loop lag, etc.)
  collectDefaultMetrics({ register: registry });

  return {
    registry,
    httpRequestsTotal: new Counter({
      name: "reef_http_requests_total",
      help: "Total number of HTTP requests received by reef-web, by method and coarse route class",
      labelNames: ["method", "route_class"] as const,
      registers: [registry],
    }),
    httpRequestDurationSeconds: new Histogram({
      name: "reef_http_request_duration_seconds",
      help: "HTTP request duration in seconds, by method and coarse route class",
      labelNames: ["method", "route_class"] as const,
      // Buckets tuned for web API responses: 10ms … 10s
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    }),
    agentLoopStepsTotal: new Counter({
      name: "reef_agent_loop_steps_total",
      help: "Total number of agent loop steps executed",
      registers: [registry],
    }),
    toolCallsTotal: new Counter({
      name: "reef_tool_calls_total",
      help: "Total number of tool calls by tool name",
      labelNames: ["tool_name"] as const,
      registers: [registry],
    }),
    casConflictsTotal: new Counter({
      name: "reef_cas_conflicts_total",
      help: "Total number of CAS (sha) conflicts during issue writes",
      registers: [registry],
    }),
  };
}

const metrics: MetricsSingleton =
  globalForMetrics.__reefMetrics ?? buildMetrics();

if (!globalForMetrics.__reefMetrics) {
  globalForMetrics.__reefMetrics = metrics;
}

/** Shared prom-client registry — exposes `.metrics()` and `.contentType`. */
export const registry: Registry = metrics.registry;

/**
 * Total number of HTTP requests handled by reef-web, labeled by HTTP method
 * and a coarse `route_class` (e.g. "/api/chat", "/api/issues", "/api/metrics",
 * "page"). The route_class is derived from the request path WITHOUT high-
 * cardinality segments (no issue ids, no query strings) — this keeps the
 * Prometheus label cardinality bounded.
 *
 * Incremented in `apps/web/src/proxy.ts` (per-request hook). Does NOT include
 * status code — the proxy runs UPSTREAM of the Route Handler and does not see
 * the response status without buffering. For status-aware metrics, instrument
 * the Route Handler directly.
 */
export const httpRequestsTotal: Counter<"method" | "route_class"> =
  metrics.httpRequestsTotal;

/**
 * HTTP request duration histogram (seconds), labeled by method and route_class.
 * Provides p50 / p99 / p999 latency via Prometheus `histogram_quantile()`.
 *
 * Usage in proxy.ts: start a timer before `NextResponse.next()`, observe after
 * the response is committed (use `startTimer()` / `observeDuration()` pattern).
 *
 * Note: the proxy does not observe post-handler duration because it runs upstream
 * of Route Handlers — the request ingress time is measurable here. For
 * accurate end-to-end latency, instrument Route Handlers individually or use
 * OpenTelemetry spans (already wired via instrumentation.ts).
 */
export const httpRequestDurationSeconds: Histogram<"method" | "route_class"> =
  metrics.httpRequestDurationSeconds;

/**
 * Total number of agent loop steps executed across all /api/chat calls.
 * Increment once per `onStepFinish` callback invocation.
 */
export const agentLoopStepsTotal: Counter<string> = metrics.agentLoopStepsTotal;

/**
 * Total number of tool calls broken down by tool name.
 * Label `tool_name` corresponds to the AI SDK `toolName` property.
 */
export const toolCallsTotal: Counter<"tool_name"> = metrics.toolCallsTotal;

/**
 * Total number of CAS (Content-Addressable Storage / sha) conflicts during
 * issue writes. Increment in Route Handler catch blocks where ConflictError
 * is detected — does not in packages/core (package boundary constraint).
 */
export const casConflictsTotal: Counter<string> = metrics.casConflictsTotal;
