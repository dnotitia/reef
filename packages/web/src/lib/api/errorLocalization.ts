/**
 * Localized Route Handler error responses (REEF-297 / ADR-0001).
 *
 * `core` describes any caught error as a locale-free `{ code, status }` via
 * `describeError` (AC4); this module is the web boundary that resolves the active
 * request locale and turns that stable code — or a web-owned boundary key — into
 * a PM-facing Response in the right language (AC1+AC2), falling back to en for
 * any key a locale omits (AC3, via the catalog merge in `i18n/messages.ts`).
 *
 * The response body shape is unchanged (`{ error, details? }`), so the client
 * `throwHttpError` → toast/dialog path is untouched; the `error` value is
 * localized. Locale is read from the request-scoped cookie + `Accept-Language`
 * through `next/headers`, so callers avoid threading `request` — and outside a
 * request scope (a unit test calling a handler directly) detection falls back to
 * en, keeping existing English-asserting route tests green.
 */
import { resolveLocale } from "@/i18n/detectLocale";
import { BASE_LOCALE, LOCALE_COOKIE, type Locale } from "@/i18n/locales";
import { type Messages, loadMessages } from "@/i18n/messages";
import { AgentErrorSchema, describeError } from "@reef/core";
import { createTranslator } from "next-intl";
import { cookies, headers } from "next/headers";

/**
 * Resolve the active locale for a Route Handler response, following ADR-0001's
 * detection chain (cookie → Accept-Language → en) off the request-scoped
 * `next/headers`. Outside a request scope
 * (a unit test that calls a handler directly) `next/headers` throws and we fall
 * back to the base locale, so existing English-asserting route tests stay green.
 * This is the server seam; the chain itself lives in the pure
 * `resolveLocale` (`i18n/detectLocale`), shared with the SSR request config.
 */
async function detectServerLocale(): Promise<Locale> {
  try {
    const [cookieStore, headerStore] = await Promise.all([
      cookies(),
      headers(),
    ]);
    return resolveLocale(
      cookieStore.get(LOCALE_COOKIE)?.value,
      headerStore.get("accept-language"),
    );
  } catch {
    return BASE_LOCALE;
  }
}

/** A dynamic `errors.*` resolver: the runtime key is a dot path (core code or
 *  web-boundary key), so the typed next-intl translator is narrowed to a plain
 *  `(key, params?) => string` like `i18n/fieldLabels` does for its namespaces.
 *  `has` is the next-intl key-presence probe, kept so the agent path can fall
 *  back to a literal when a stable error code has no catalog entry. */
type ErrorTranslator = ((
  key: string,
  params?: Record<string, string>,
) => string) & {
  has: (key: string) => boolean;
};

function errorsTranslator(locale: Locale): ErrorTranslator {
  const messages: Messages = loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "errors" });
  return t as unknown as ErrorTranslator;
}

/**
 * Localize a caught core error (any `ReefError` or unknown) into a PM-facing
 * Response in the request locale. `describeError` supplies the stable code,
 * HTTP status, ICU params, and any caller-controlled `details`.
 */
export async function localizeError(err: unknown): Promise<Response> {
  const { code, status, params, details } = describeError(err);
  const locale = await detectServerLocale();
  const body: { error: string; details?: string[] } = {
    error: errorsTranslator(locale)(code, params),
  };
  if (details) body.details = details;
  return Response.json(body, { status });
}

/**
 * Localize a web-owned boundary error (a key under `errors.*` that the Route
 * Handler raises directly, e.g. an expired session or invalid body) into a
 * Response in the request locale. `details` passes a structured payload (e.g. a
 * Zod `flatten()`) straight through, unlocalized, exactly as before.
 */
export async function localizedErrorResponse(
  key: string,
  status: number,
  options?: { details?: unknown },
): Promise<Response> {
  const locale = await detectServerLocale();
  const body: { error: string; details?: unknown } = {
    error: errorsTranslator(locale)(key),
  };
  if (options?.details !== undefined) body.details = options.details;
  return Response.json(body, { status });
}

/**
 * Build the agent streaming error envelope from an already-resolved message
 * (REEF-308). The agent routes (`agents/runs`, `agents/artifacts`) return
 * `{ error, runtime_error: { code, message, recoverable, details } }`, with
 * `recoverable` derived from the HTTP status (>=500). This is the single
 * envelope builder, shared by `localizedAgentError` and the already-localized
 * `ReefError` agent path (`reefAgentErrorResponse`); it replaces the
 * per-route `jsonAgentError` duplicates.
 */
export function agentErrorEnvelope(
  message: string,
  status: number,
  code: string,
  details: Record<string, unknown> = {},
): Response {
  return Response.json(
    {
      error: message,
      runtime_error: AgentErrorSchema.parse({
        code,
        message,
        recoverable: status >= 500,
        details,
      }),
    },
    { status },
  );
}

/**
 * Localize an agent streaming error into the request locale (REEF-308). The
 * agent envelopes and `AgentArtifactCommandError` carry a stable snake_case
 * `code`; this boundary resolves the PM-facing message from an `errors.*` key
 * for the active locale (falling back to en per key via the catalog merge, AC3)
 * and keeps the `code`/`recoverable` contract unchanged — both `error` and
 * `runtime_error.message` carry the localized text (AC2). `fallback` (the
 * caller's English default) is used only when the catalog has no entry for
 * `key`, so an unmapped future code still ships a message rather than a raw key
 * path.
 */
export async function localizedAgentError(
  key: string,
  status: number,
  code: string,
  details: Record<string, unknown> = {},
  fallback?: string,
): Promise<Response> {
  const locale = await detectServerLocale();
  const t = errorsTranslator(locale);
  const message = fallback !== undefined && !t.has(key) ? fallback : t(key);
  return agentErrorEnvelope(message, status, code, details);
}
