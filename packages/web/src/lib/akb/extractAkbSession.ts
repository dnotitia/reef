import { AuthError } from "@reef/core";
import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";
import {
  SESSION_COOKIE,
  isJwtExpired,
  parseCookieHeader,
} from "./sessionCookie";

/**
 * Extract the akb session JWT from the `__reef_session` cookie.
 *
 * Accepts either a Web API `Request` (Route Handlers) or Next.js
 * `ReadonlyHeaders` (Server Actions). The `Authorization` header that the
 * browser may send is intentionally ignored — reef-web treats the httpOnly
 * cookie as the sole canonical source so an XSS-grabbed bearer header does not
 * impersonate the user.
 *
 * Throws AuthError if the cookie is absent or its JWT is already expired
 * (`exp` claim past). Note: signature verification is delegated to the akb
 * backend on each forwarded request — we just short-circuit on `exp`.
 */
export function extractAkbSession(source: Request | ReadonlyHeaders): string {
  const headers = source instanceof Request ? source.headers : source;
  const cookies = parseCookieHeader(headers.get("cookie"));
  const jwt = cookies[SESSION_COOKIE];
  if (!jwt) {
    throw new AuthError({ message: "missing_session_cookie" });
  }
  if (isJwtExpired(jwt)) {
    throw new AuthError({ message: "expired_session_cookie" });
  }
  return jwt;
}
