import { LOCALE_COOKIE, type Locale } from "@/i18n/locales";

export type { Locale } from "@/i18n/locales";

/**
 * One year. The locale cookie is the SSR transport for a long-lived per-device
 * preference, not a session token, so it should outlive the akb session cookie;
 * IndexedDB still restores the choice if the cookie is ever cleared.
 */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Apply a locale on the client: update `<html lang>` for immediate feedback and
 * mirror the choice into the non-httpOnly `NEXT_LOCALE` cookie the server reads
 * on the next request.
 *
 * The DOM `lang` write gives an instant response; a following `router.refresh()`
 * (see `useLocalePreference`) re-renders the server tree so message strings
 * switch too. The cookie is deliberately readable by JS (it is a UI preference,
 * not a secret) and is written here rather than via a Set-Cookie response so the
 * client owns it — mirroring how `applyTheme` owns the localStorage mirror.
 */
export function applyLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}
