import {
  RequestLogSpanProcessor,
  responseLoggingEnabled,
} from "@/lib/logging/requestSpanLog";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { setCoreLogger } from "@reef/core";
import pkg from "../../../package.json";

/**
 * Node.js-runtime instrumentation.
 *
 * Loaded dynamically from `instrumentation.ts` when `NEXT_RUNTIME === 'nodejs'`.
 * The Edge runtime does not imports this module, so `@opentelemetry/sdk-node` and
 * `process.once` (both Node) stay out of the Edge bundle.
 *
 * Security invariant: OTEL_EXPORTER_OTLP_HEADERS carries Langfuse API keys as
 * HTTP headers on outbound OTLP calls just — they are not recorded in span
 * attributes, log output, or response bodies.
 */
export function registerNode() {
  // Parse comma-separated key=value pairs from OTEL_EXPORTER_OTLP_HEADERS.
  // Example: "x-langfuse-public-key=pk-...,x-langfuse-secret-key=sk-..."
  const headersRaw = process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "";
  const headers: Record<string, string> = {};
  if (headersRaw) {
    for (const pair of headersRaw.split(",")) {
      const eqIndex = pair.indexOf("=");
      if (eqIndex > 0) {
        const key = pair.slice(0, eqIndex).trim();
        const value = pair.slice(eqIndex + 1).trim();
        if (key) {
          headers[key] = value;
        }
      }
    }
  }

  // URL resolution follows the OTEL spec:
  //   - OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, if set, is used as-is (full URL).
  //   - Otherwise, OTEL_EXPORTER_OTLP_ENDPOINT is treated as a base and
  //     `/v1/traces` is appended (with single-slash normalization).
  //   - Otherwise, fall back to http://localhost:4318/v1/traces.
  // Passing the OTLPTraceExporter `url` overrides the SDK's default path
  // resolution, so we should resolve the path here.
  const tracesEndpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    (process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/+$/, "")}/v1/traces`
      : "http://localhost:4318/v1/traces");

  // OTLP export is consistently on; the response-completion access log is dev by
  // default (see `responseLoggingEnabled` for the deploy-time opt-in).
  const spanProcessors: tracing.SpanProcessor[] = [
    new tracing.BatchSpanProcessor(
      new OTLPTraceExporter({ url: tracesEndpoint, headers }),
    ),
  ];
  if (responseLoggingEnabled()) {
    spanProcessors.push(new RequestLogSpanProcessor());
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "reef-web",
      [ATTR_SERVICE_VERSION]: pkg.version,
    }),
    // When `spanProcessors` is provided, NodeSDK ignores `traceExporter`'s
    // default BatchSpanProcessor, so the OTLP exporter should be wrapped here
    // explicitly to preserve trace export (consistently on, every environment).
    //
    // The RequestLogSpanProcessor — which turns each request span into a stdout
    // `response` log — is dev/deploy-split: enabled in development for quick
    // local inspection, off in production where status/duration live in the
    // exported traces (standard logs/traces separation). See
    // `responseLoggingEnabled`.
    spanProcessors,
    // Correlate logs with traces: when a pino log is emitted inside an active
    // span, this injects `trace_id` / `span_id` / `trace_flags` into the log
    // record. `disableLogSending: true` is load-bearing — by default the
    // instrumentation also forwards every pino record to the OpenTelemetry Logs
    // API, and NodeSDK auto-registers an OTLP logs exporter when
    // OTEL_LOGS_EXPORTER is unset, which would ship all backend logs over OTLP on
    // top of stdout. We want correlation just; log delivery stays stdout for the
    // collector to tail. The SDK starts before any Route Handler imports the
    // logger, so pino is patched in time. (REEF-235)
    instrumentations: [new PinoInstrumentation({ disableLogSending: true })],
  });

  sdk.start();

  // Wire the core observability seam to the shared pino logger so `core`'s
  // "emit once, shape twice" instrumentation (scan checkpoints, LLM token usage,
  // upstream latency — REEF-271) can surface as stdout lines, NOT just span
  // attributes. Gated by the same dev/deploy split as the `response` access log
  // (`responseLoggingEnabled`): on in dev, opt-in via `REEF_RESPONSE_LOG=1`
  // where there is no trace backend. With a trace backend (prod default) the
  // logger stays unwired and `core` emits span attributes only — no stdout noise.
  //
  // The logger is imported lazily AFTER `sdk.start()` for the same reason as
  // `RequestLogSpanProcessor`: constructing the pino singleton before
  // PinoInstrumentation installs its module hook would strip trace correlation
  // (the REEF-235 invariant). `setCoreLogger` itself carries no pino, so it is
  // safe to import eagerly.
  if (responseLoggingEnabled()) {
    void import("@/lib/logging/logger").then(({ logger }) => {
      setCoreLogger({
        info: (fields, msg) => logger.info(fields, msg),
        warn: (fields, msg) => logger.warn(fields, msg),
        debug: (fields, msg) => logger.debug(fields, msg),
      });
    });
  }

  // Graceful shutdown: flush in-flight spans before the Node.js process exits.
  // Without this, spans buffered in the OTLP exporter's batch queue are lost
  // when Next.js receives SIGTERM (e.g. from docker stop or K8s pod eviction).
  // `once` prevents double-shutdown if both signals fire.
  const shutdown = () => {
    sdk.shutdown().catch(() => {
      // Ignore shutdown errors — the process is exiting anyway.
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
