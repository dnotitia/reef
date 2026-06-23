import pino from "pino";

/**
 * Structured backend logger (pino).
 *
 * Both safety mechanisms live in the pino instance config, not in a wrapper, so
 * the exported `logger` is safe to use directly (`logger.info`, `logger.error`,
 * `logger.child(...)`):
 *
 * - **Credential redaction** — the `headers` serializer (`redactHeaderObject`)
 *   censors `Authorization`, `X-Reef-LLM`, `Cookie`, `Set-Cookie`, and
 *   `Proxy-Authorization` from any logged `headers` object, case-insensitively
 *   (so canonical `Authorization` and lowercase `authorization` are both caught).
 * - **Safe error serialization** — the `err` serializer projects errors to a
 *   `type` / `message` / `stack` allowlist. pino's *default* error serializer
 *   copies every enumerable property of an Error; external SDK errors (e.g.
 *   Octokit `RequestError`) carry `.request.headers` with live credentials that
 *   header redaction would not reach. Overriding the serializer keeps those out
 *   of the log regardless of who calls `logger.error({ err })`.
 *
 * Emits one JSON line per event to stdout in production and pretty output in
 * development. Trace correlation (`trace_id` / `span_id`) is injected by
 * `@opentelemetry/instrumentation-pino` (registered in `instrumentation-node.ts`);
 * this module knows nothing about OpenTelemetry.
 *
 * Code uses `logger` directly; the config makes that safe, so there is no facade.
 * Per-request logging happens once at the Edge `proxy.ts` boundary (which does not
 * load pino and keeps its own `console.log` JSON shim), not in each route handler.
 *
 * @see ../../proxy.ts — Edge request-logging boundary
 */

/**
 * Credential-bearing HTTP header names that should not reach a log sink.
 * Lowercase; matching is case-insensitive (see `redactHeaderObject`), so
 * canonical (`Authorization`, `Cookie`) and WHATWG-lowercased casings are both
 * covered.
 */
const SENSITIVE_HEADERS = [
  "authorization",
  "x-reef-llm",
  "cookie",
  "set-cookie",
  "proxy-authorization",
] as const;

const SENSITIVE_HEADER_SET = new Set<string>(SENSITIVE_HEADERS);

/** The placeholder substituted for every redacted credential value. */
const REDACTED = "[REDACTED]";

/**
 * pino `serializers.headers`: censors credential headers case-insensitively,
 * preserving non-sensitive entries and the original key casing, so
 * `logger.info({ headers })` is safe regardless of header-key casing.
 */
function redactHeaderObject(headers: unknown): unknown {
  if (headers === null || typeof headers !== "object") {
    return headers;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = SENSITIVE_HEADER_SET.has(key.toLowerCase())
      ? REDACTED
      : value;
  }
  return result;
}

/**
 * Typed errors whose `context.message` is bounded backend text safe to surface
 * as the `upstream` log field: `AkbApiError` carries akb's FastAPI `detail`,
 * `GitHubApiError` the Octokit error message. This is an ALLOWLIST, not a
 * denylist — `LlmError.context.message` is free-form provider output (it folds
 * in response bodies via `extractErrorDetail`, which can carry credential-bearing
 * diagnostics), and any future typed error is untrusted by default, so neither
 * reaches stdout. (REEF-271 / the REEF-235 credential-safe boundary.)
 */
const UPSTREAM_DETAIL_SAFE_ERRORS = new Set(["AkbApiError", "GitHubApiError"]);

/**
 * Project any thrown value to a safe, credential-free log shape.
 *
 * Beyond the `type`/`message`/`stack` allowlist, this preserves the upstream
 * HTTP `status` that reef's typed API errors otherwise hide behind a generic
 * PM-facing message (REEF-271): `logger.error({ err })` on an `AkbApiError`
 * previously read only "Authentication failed." with no way to tell a 502 from a
 * 404. The numeric `status` is always safe to copy. The free-form upstream
 * detail is copied only for {@link UPSTREAM_DETAIL_SAFE_ERRORS}; the nested
 * `request`/`response` objects (Octokit `RequestError.request.headers`) and any
 * untrusted typed error's detail are never copied.
 */
function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { message: String(err) };
  }
  const out: Record<string, unknown> = {
    type: err.name,
    message: err.message,
    stack: err.stack,
  };
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number") {
    out.status = status;
  }
  if (UPSTREAM_DETAIL_SAFE_ERRORS.has(err.name)) {
    const context = (err as { context?: unknown }).context;
    if (
      context !== null &&
      typeof context === "object" &&
      typeof (context as { message?: unknown }).message === "string"
    ) {
      out.upstream = (context as { message: string }).message;
    }
  }
  return out;
}

/**
 * Build pino options for the given runtime mode. Pure and exported so the
 * dev-pretty / prod-JSON branch and the header/error serializers are unit-
 * testable without constructing a logger or spawning a transport worker thread.
 */
export function buildLoggerOptions(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): pino.LoggerOptions {
  const isDev = nodeEnv === "development";
  return {
    level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
    serializers: { err: serializeError, headers: redactHeaderObject },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              ignore: "pid,hostname",
              translateTime: "SYS:standard",
            },
          },
        }
      : {}),
  };
}

const options = buildLoggerOptions();

/**
 * The shared logger instance — safe to import and use directly.
 *
 * In development, pino-pretty runs as a transport (worker thread) and owns the
 * sink. Otherwise pino writes JSON lines through a thin stdout shim rather than
 * `pino.destination`/sonic-boom, so the redaction boundary stays directly
 * spyable in unit tests; at reef's request-log volume the loss of sonic-boom
 * batching is irrelevant.
 */
export const logger = options.transport
  ? pino(options)
  : pino(options, {
      write: (line: string): void => {
        process.stdout.write(line);
      },
    });
