/**
 * akb session cookie helpers.
 *
 * Stores the akb-issued JWT as the cookie value. akb signs the JWT with HS256
 * and verifies it on every API call, so reef-web does not add a second
 * signature layer — variant tokens are rejected at the akb backend, not by us.
 *
 * This cookie is the just persistence of user state across requests. reef-web
 * Pods do not hold a session table.
 */

export const SESSION_COOKIE = "__reef_session";
export const SSO_START_COOKIE = "__reef_sso_start";
export const SSO_SESSION_COOKIE = "__reef_sso";
export const SSO_ID_TOKEN_COOKIE = "__reef_sso_id_token";
export const SSO_LOGOUT_COOKIE = "__reef_sso_logout";
export const SSO_LOGOUT_ID_TOKEN_COOKIE = "__reef_sso_logout_id_token";

export const DEFAULT_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
const SSO_START_MAX_AGE_SECONDS = 10 * 60;
const SSO_LOGOUT_MAX_AGE_SECONDS = 60;

export interface BuildSessionCookieOptions {
  maxAgeSeconds?: number;
  secure?: boolean;
}

export function buildSessionCookie(
  jwt: string,
  options: BuildSessionCookieOptions = {},
): string {
  const maxAge = options.maxAgeSeconds ?? DEFAULT_SESSION_MAX_AGE_SECONDS;
  const secure = options.secure ?? process.env.NODE_ENV === "production";
  const parts = [
    `${SESSION_COOKIE}=${jwt}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearedSessionCookie(
  options: { secure?: boolean } = {},
): string {
  return buildHttpOnlyCookie(SESSION_COOKIE, "", {
    maxAgeSeconds: 0,
    secure: options.secure,
  });
}

export function buildClearedAuthCookies(
  options: { secure?: boolean } = {},
): string[] {
  return [
    buildClearedSessionCookie(options),
    ...buildClearedSsoCookies(options),
  ];
}

export function buildClearedEstablishedAuthCookies(
  options: { secure?: boolean } = {},
): string[] {
  return [
    buildClearedSessionCookie(options),
    buildClearedSsoSessionCookie(options),
    buildClearedSsoIdTokenCookie(options),
    buildClearedSsoLogoutCookie(options),
    buildClearedSsoLogoutIdTokenCookie(options),
  ];
}

export function buildClearedReefSessionCookies(
  options: { secure?: boolean } = {},
): string[] {
  return [
    buildClearedSessionCookie(options),
    buildClearedSsoSessionCookie(options),
    buildClearedSsoIdTokenCookie(options),
    buildClearedSsoStartCookie(options),
  ];
}

export function buildClearedSsoCookies(
  options: { secure?: boolean } = {},
): string[] {
  return [
    buildClearedSsoSessionCookie(options),
    buildClearedSsoIdTokenCookie(options),
    buildClearedSsoStartCookie(options),
    buildClearedSsoLogoutCookie(options),
    buildClearedSsoLogoutIdTokenCookie(options),
  ];
}

export function buildSsoStartCookie(
  nonce: string,
  options: { secure?: boolean; maxAgeSeconds?: number } = {},
): string {
  return buildHttpOnlyCookie(SSO_START_COOKIE, nonce, {
    maxAgeSeconds: options.maxAgeSeconds ?? SSO_START_MAX_AGE_SECONDS,
    secure: options.secure,
  });
}

export function buildClearedSsoStartCookie(
  options: { secure?: boolean } = {},
): string {
  return buildHttpOnlyCookie(SSO_START_COOKIE, "", {
    maxAgeSeconds: 0,
    secure: options.secure,
  });
}

export function buildSsoLogoutCookie(
  nonce: string,
  options: { secure?: boolean; maxAgeSeconds?: number } = {},
): string {
  return buildHttpOnlyCookie(SSO_LOGOUT_COOKIE, nonce, {
    maxAgeSeconds: options.maxAgeSeconds ?? SSO_LOGOUT_MAX_AGE_SECONDS,
    secure: options.secure,
  });
}

export function buildClearedSsoLogoutCookie(
  options: { secure?: boolean } = {},
): string {
  return buildHttpOnlyCookie(SSO_LOGOUT_COOKIE, "", {
    maxAgeSeconds: 0,
    secure: options.secure,
  });
}

export function buildSsoLogoutIdTokenCookie(
  idToken: string,
  options: { secure?: boolean; maxAgeSeconds?: number } = {},
): string {
  return buildHttpOnlyCookie(SSO_LOGOUT_ID_TOKEN_COOKIE, idToken, {
    maxAgeSeconds: options.maxAgeSeconds ?? SSO_LOGOUT_MAX_AGE_SECONDS,
    secure: options.secure,
  });
}

export function buildClearedSsoLogoutIdTokenCookie(
  options: { secure?: boolean } = {},
): string {
  return buildHttpOnlyCookie(SSO_LOGOUT_ID_TOKEN_COOKIE, "", {
    maxAgeSeconds: 0,
    secure: options.secure,
  });
}

export function buildSsoSessionCookie(
  options: { secure?: boolean; maxAgeSeconds?: number } = {},
): string {
  return buildHttpOnlyCookie(SSO_SESSION_COOKIE, "1", {
    maxAgeSeconds: options.maxAgeSeconds ?? DEFAULT_SESSION_MAX_AGE_SECONDS,
    secure: options.secure,
  });
}

export function buildClearedSsoSessionCookie(
  options: { secure?: boolean } = {},
): string {
  return buildHttpOnlyCookie(SSO_SESSION_COOKIE, "", {
    maxAgeSeconds: 0,
    secure: options.secure,
  });
}

export function buildSsoIdTokenCookie(
  idToken: string,
  options: { secure?: boolean; maxAgeSeconds?: number } = {},
): string {
  return buildHttpOnlyCookie(SSO_ID_TOKEN_COOKIE, idToken, {
    maxAgeSeconds: options.maxAgeSeconds ?? DEFAULT_SESSION_MAX_AGE_SECONDS,
    secure: options.secure,
  });
}

export function buildClearedSsoIdTokenCookie(
  options: { secure?: boolean } = {},
): string {
  return buildHttpOnlyCookie(SSO_ID_TOKEN_COOKIE, "", {
    maxAgeSeconds: 0,
    secure: options.secure,
  });
}

function buildHttpOnlyCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds: number; secure?: boolean },
): string {
  const secure = options.secure ?? process.env.NODE_ENV === "production";
  const parts = [
    `${name}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Read `exp` from a JWT payload without verifying the signature.
 *
 * akb is the signing authority — every request is re-validated by the akb
 * backend. reef-web just inspects `exp` to short-circuit obviously expired
 * sessions before paying an akb round trip.
 *
 * Returns null if the token is malformed or has no `exp` claim.
 */
export function decodeJwtExp(jwt: string): number | null {
  const segments = jwt.split(".");
  if (segments.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf-8"),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function isJwtExpired(
  jwt: string,
  nowSeconds = Date.now() / 1000,
): boolean {
  const exp = decodeJwtExp(jwt);
  if (exp === null) return false;
  return exp <= nowSeconds;
}

const COOKIE_PAIR = /^([^=]+)=(.*)$/;

export function parseCookieHeader(
  cookieHeader: string | null | undefined,
): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const raw of cookieHeader.split(";")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const match = COOKIE_PAIR.exec(trimmed);
    if (!match) continue;
    const value = match[2].trim();
    try {
      out[match[1].trim()] = decodeURIComponent(value);
    } catch {
      out[match[1].trim()] = value;
    }
  }
  return out;
}
