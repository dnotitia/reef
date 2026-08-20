import { parseCookieHeader } from "@/lib/akb/sessionCookie";

export const AUTH_V2_SESSION_COOKIE = "__reef_auth_v2";
export const AUTH_V2_STATE_COOKIE = "__reef_auth_v2_state";

const MAX_COOKIE_VALUE_BYTES = 4_096;

export function readAuthV2Cookies(request: Request): Record<string, string> {
  return parseCookieHeader(request.headers.get("cookie"));
}

export function buildAuthV2SessionCookie(
  handle: string,
  maxAgeSeconds: number,
): string {
  return buildCookie(AUTH_V2_SESSION_COOKIE, handle, maxAgeSeconds);
}

export function buildAuthV2StateCookie(
  providerAlias: string,
  browserBinding: string,
): string {
  // The provider alias is public catalog data; the binding remains a random
  // one-time value. Keeping both in one cookie lets the callback select the
  // configured validator without a provider value in a token or URL.
  return buildCookie(
    AUTH_V2_STATE_COOKIE,
    `${providerAlias}.${browserBinding}`,
    10 * 60,
  );
}

export function parseAuthV2StateCookie(
  value: string | undefined,
): { providerAlias: string; browserBinding: string } | null {
  if (!value || value.length > MAX_COOKIE_VALUE_BYTES) return null;
  const separator = value.indexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;
  const providerAlias = value.slice(0, separator);
  const browserBinding = value.slice(separator + 1);
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/u.test(providerAlias)) return null;
  if (!/^[A-Za-z0-9_-]{43}$/u.test(browserBinding)) return null;
  return { providerAlias, browserBinding };
}

export function buildClearedAuthV2SessionCookie(): string {
  return buildCookie(AUTH_V2_SESSION_COOKIE, "", 0);
}

export function buildClearedAuthV2StateCookie(): string {
  return buildCookie(AUTH_V2_STATE_COOKIE, "", 0);
}

function buildCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${name}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
