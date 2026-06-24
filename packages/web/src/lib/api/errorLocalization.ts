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
 * `throwHttpError` → toast/dialog path is untouched; only the `error` value is
 * localized. Locale is read from the request-scoped cookie + `Accept-Language`
 * through `next/headers`, so callers do not thread `request` — and outside a
 * request scope (a unit test calling a handler directly) detection falls back to
 * en, keeping existing English-asserting route tests green.
 */
import { resolveLocale } from "@/i18n/detectLocale";
import { BASE_LOCALE, LOCALE_COOKIE, type Locale } from "@/i18n/locales";
import { type Messages, loadMessages } from "@/i18n/messages";
import { describeError } from "@reef/core";
import { createTranslator } from "next-intl";
import { cookies, headers } from "next/headers";

/**
 * Resolve the active locale for a Route Handler response, following ADR-0001's
 * detection chain (cookie → Accept-Language → en) off the request-scoped
 * `next/headers`, so callers do not thread `request`. Outside a request scope
 * (a unit test that calls a handler directly) `next/headers` throws and we fall
 * back to the base locale, so existing English-asserting route tests stay green.
 * This is the one server-only seam; the chain itself lives in the pure
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
 *  `(key, params?) => string` like `i18n/fieldLabels` does for its namespaces. */
type ErrorTranslator = (key: string, params?: Record<string, string>) => string;

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
