import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { resolveLocale } from "./detectLocale";
import { LOCALE_COOKIE } from "./locales";
import { loadMessages } from "./messages";

/**
 * next-intl request configuration (without i18n routing — ADR-0001).
 *
 * Wired through `createNextIntlPlugin` in `next.config.ts`. Runs per request on
 * the server; reading the cookie + `Accept-Language` opts the route into
 * dynamic rendering, which the app already is (the root layout reads
 * `headers()` for the CSP nonce).
 *
 * The locale is resolved from the detection chain (cookie → Accept-Language →
 * en) and the messages are the en base overlaid with the active locale, so the
 * first server paint is already in the correct language and `<html lang>` (set
 * from `getLocale()` in the root layout) matches it.
 *
 * Time zone is pinned to UTC: ADR-0001 keeps dates TZ-stable across viewers to
 * avoid hydration mismatches; only the locale varies per viewer.
 */
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerStore.get("accept-language"),
  );

  return {
    locale,
    messages: loadMessages(locale),
    timeZone: "UTC",
  };
});
