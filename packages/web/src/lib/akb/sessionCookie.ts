/** Local AKB session and auth-invalidation cookie helpers. */

export const SESSION_COOKIE = "__reef_session";
export const AUTH_INVALIDATION_COOKIE = "__reef_auth_invalidated";
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
const AUTH_INVALIDATION_MAX_AGE_SECONDS = 60;

export interface BuildSessionCookieOptions {
  maxAgeSeconds?: number;
  secure?: boolean;
}

export function buildSessionCookie(
  jwt: string,
  options: BuildSessionCookieOptions = {},
): string {
  const maxAge = options.maxAgeSeconds ?? DEFAULT_SESSION_MAX_AGE_SECONDS;
  return buildHttpOnlyCookie(SESSION_COOKIE, jwt, {
    maxAgeSeconds: maxAge,
    secure: options.secure,
  });
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
  return [buildClearedSessionCookie(options)];
}

export function buildClearedEstablishedAuthCookies(
  options: { secure?: boolean } = {},
): string[] {
  return [buildClearedSessionCookie(options)];
}

export function buildAuthInvalidationCookie(
  options: { secure?: boolean } = {},
): string {
  return buildHttpOnlyCookie(AUTH_INVALIDATION_COOKIE, "1", {
    maxAgeSeconds: AUTH_INVALIDATION_MAX_AGE_SECONDS,
    secure: options.secure,
  });
}

export function buildClearedAuthInvalidationCookie(
  options: { secure?: boolean } = {},
): string {
  return buildHttpOnlyCookie(AUTH_INVALIDATION_COOKIE, "", {
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
  return exp !== null && exp <= nowSeconds;
}

const ACTOR_CLAIMS = ["username", "preferred_username", "sub"] as const;

function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const segments = jwt.split(".");
  if (segments.length < 2) return null;
  try {
    const b64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function firstClaimString(
  claims: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = claims[key];
    if (typeof value === "string" && value.trim().length > 0)
      return value.trim();
  }
  return null;
}

export function decodeSessionActor(jwt: string): string | null {
  const claims = decodeJwtClaims(jwt);
  return claims ? firstClaimString(claims, ACTOR_CLAIMS) : null;
}

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
    try {
      out[match[1].trim()] = decodeURIComponent(match[2].trim());
    } catch {
      out[match[1].trim()] = match[2].trim();
    }
  }
  return out;
}
