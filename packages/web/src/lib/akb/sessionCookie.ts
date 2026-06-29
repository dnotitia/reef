/**
 * akb session cookie helpers.
 *
 * Stores the akb-issued JWT as the cookie value. akb signs the JWT with HS256
 * and verifies it on every API call, so reef-web not add a second
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

/** JWT claims, in order, that carry a loggable actor identifier. */
const ACTOR_CLAIMS = ["username", "preferred_username", "sub"] as const;

/**
 * Parse a session JWT's payload claims WITHOUT verifying the signature (akb
 * re-validates every forwarded request). Returns the decoded claim object, or
 * null when the token is malformed. Decoded with the Web `atob` + URL-safe
 * base64 normalization rather than Node's `Buffer`, so it is runtime-agnostic —
 * the proxy defaults to the Node runtime in Next.js 16, but keeping this off
 * Node-only globals removes any edge-runtime doubt.
 */
function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const segments = jwt.split(".");
  if (segments.length < 2) return null;
  try {
    const b64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded); // Web API global — Node 18+ and edge alike
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/** First non-empty string claim (trimmed) from `claims` in `keys` order, else null. */
function firstClaimString(
  claims: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = claims[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Read a display/audit actor identifier from a session JWT's claims. Returns the
 * first non-empty `username` / `preferred_username` / `sub` claim, or null when
 * the token is malformed or carries none.
 *
 * Used by `proxy.ts` to stamp the request log line with the akb username so an
 * error can be tied to a user (REEF-271). It returns just a public identity
 * claim — not the raw token — so the result is safe to log; the JWT itself stays
 * out of every sink. This is a best-effort, spoofable LOG hint: it deliberately
 * also accepts `preferred_username` / `sub`, which need NOT equal the akb
 * username. For a functional scope decision use {@link decodeSessionUsername}.
 */
export function decodeSessionActor(jwt: string): string | null {
  const claims = decodeJwtClaims(jwt);
  return claims ? firstClaimString(claims, ACTOR_CLAIMS) : null;
}

/**
 * Read ONLY the akb `username` claim from a session JWT (no signature
 * verification). The `username` claim is the akb-native username — the same
 * value `/auth/me` returns and that `reef_issues.assigned_to` stores — so it is
 * safe to drive a functional scope decision (the default-view My-Issues filter,
 * REEF-324), unlike the looser {@link decodeSessionActor}, which also accepts
 * `preferred_username` (an SSO display name) or `sub` (an opaque UUID) that need
 * not equal the akb username. Returns null when the token carries no `username`
 * claim, so the caller falls back to the canonical `/auth/me` actor.
 */
export function decodeSessionUsername(jwt: string): string | null {
  const claims = decodeJwtClaims(jwt);
  return claims ? firstClaimString(claims, ["username"]) : null;
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
