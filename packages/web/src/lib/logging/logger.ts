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
 * Project any thrown value to a safe, credential-free log shape.
 *
 * Beyond the `type`/`message`/`stack` allowlist, this preserves the upstream HTTP
 * `status` that reef's typed API errors otherwise hide behind a generic PM-facing
 * message (REEF-271): `logger.error({ err })` on an `AkbApiError` previously read
 * just "Authentication failed." with no way to tell a 502 from a 404. A numeric
 * `status` is consistently safe to copy.
 *
 * The upstream *detail* string (`context.message`) is deliberately NOT logged:
 * every source of it is upstream-controlled free text — an LLM provider response
 * body (`LlmError`, via `extractErrorDetail`), an Octokit / GitHub Enterprise
 * error message (`GitHubApiError`), an akb FastAPI `detail` (`AkbApiError`) — so
 * copying it would re-open the very credential-safe boundary this allowlist
 * exists to hold (REEF-235). Distinguishing the failure by `status` is the
 * load-bearing half of REEF-271; the body stays out of the log. The nested
 * `request`/`response` objects (Octokit `RequestError.request.headers`) are does not
 * copied either.
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
