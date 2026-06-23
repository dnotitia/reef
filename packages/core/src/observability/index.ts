import type { Span } from "@opentelemetry/api";

/**
 * Backend observability seam — "emit once, shape twice" (REEF-271).
 *
 * `core` owns all GitHub / akb / LLM I/O and wraps it in OpenTelemetry spans
 * (prod → trace backend). But the rich data a developer needs to see locally —
 * scan checkpoints, LLM token usage, upstream latency — is invisible in dev,
 * because dev runs no Jaeger/Langfuse and spans are dropped. The fix is to emit
 * the SAME fields twice at one instrumentation point: as span attributes (always,
 * for prod OTel) and as one structured log line (for dev stdout / a trace-backend-
 * less prod).
 *
 * The log half goes through a *port*, not a concrete logger: `core` is framework-
 * agnostic and cannot import `web`'s pino instance (that would invert the
 * `web → core` dependency and duplicate the redaction config). Instead `web` wires
 * a `CoreLogger` at instrumentation startup via {@link setCoreLogger}. When no
 * logger is wired (the default), the log half is a no-op, so:
 *
 *   - prod WITH a trace backend  → only span attributes (stdout stays quiet)
 *   - dev, or prod with `REEF_RESPONSE_LOG=1` → web wires the pino logger, so the
 *     same fields also appear as a stdout line, correlated by `trace_id`.
 *
 * The dev/prod split therefore lives entirely in `web` (where env knowledge and
 * the pino instance live): `core` reads no env and holds no logger config. This
 * reuses the existing `responseLoggingEnabled` (dev || `REEF_RESPONSE_LOG=1`)
 * gate — see `web/src/lib/logging/requestSpanLog.ts`.
 */

/**
 * Minimal structured-logger port — a pino subset (`info`/`warn`/`debug`, each
 * `(fields, msg)`). `web` adapts its pino `logger` to this shape. Kept tiny on
 * purpose: `core` depends on the contract, not on pino.
 */
export interface CoreLogger {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
  debug(fields: Record<string, unknown>, msg: string): void;
}

const NOOP_LOGGER: CoreLogger = {
  info() {},
  warn() {},
  debug() {},
};

let currentLogger: CoreLogger = NOOP_LOGGER;

/**
 * Wire (or clear) the process-wide core logger. Called once by `web` at
 * instrumentation startup when stdout logging is enabled; passing `null` resets
 * to the silent no-op (used by tests and by prod-with-trace-backend). Idempotent.
 */
export function setCoreLogger(logger: CoreLogger | null): void {
  currentLogger = logger ?? NOOP_LOGGER;
}

/** The currently wired logger, or the silent no-op when none is set. */
export function getCoreLogger(): CoreLogger {
  return currentLogger;
}

export type ObserveLevel = "info" | "warn" | "debug";

/** Attribute/log field bag. `undefined` values are dropped from both shapes. */
export type ObserveFields = Record<
  string,
  string | number | boolean | undefined
>;

export interface ObserveOptions {
  /** Log level for the stdout line. Defaults to `"info"`. */
  level?: ObserveLevel;
}

/**
 * Emit one measurement two ways: set each defined field as a span attribute on
 * `span` (prod → OTel) AND emit one structured log line via the wired
 * {@link CoreLogger} (dev stdout / log-only prod). `undefined` fields are
 * dropped from both. When no span is given, only the log line is emitted; when
 * no logger is wired, only the attributes are set.
 */
export function observe(
  span: Span | undefined,
  fields: ObserveFields,
  msg: string,
  options: ObserveOptions = {},
): void {
  const logFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    span?.setAttribute(key, value);
    logFields[key] = value;
  }
  currentLogger[options.level ?? "info"](logFields, msg);
}
