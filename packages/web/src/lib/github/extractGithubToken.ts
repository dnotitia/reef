import { AuthError } from "@reef/core";
import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";

const BEARER_PREFIX = "Bearer ";

/**
 * Resolve a header getter from either a `Request` or Next.js `ReadonlyHeaders`.
 *
 * This allows both Route Handlers (receive `Request`) and Server Actions
 * (receive `ReadonlyHeaders` from `next/headers`) to call the same extractor
 * without a synthetic Request wrapper.
 */
function getHeaders(source: Request | ReadonlyHeaders): {
  get: (name: string) => string | null;
} {
  return source instanceof Request ? source.headers : source;
}

/**
 * Extract the GitHub OAuth token from the Authorization header.
 *
 * Accepts either a Web API `Request` (Route Handlers) or Next.js
 * `ReadonlyHeaders` (Server Actions), eliminating the need for a synthetic
 * Request wrapper in Server Action callers.
 *
 * Placement: apps/web (not packages/core) — depends on Next.js types.
 * packages/core should remain framework-agnostic (no DOM/Web API imports).
 *
 * Throws AuthError if the header is absent or not in `Bearer <token>` format.
 */
export function extractGithubToken(source: Request | ReadonlyHeaders): string {
  const headers = getHeaders(source);
  const authHeader = headers.get("authorization");
  if (!authHeader) {
    throw new AuthError({ message: "missing_authorization_header" });
  }
  if (!authHeader.startsWith(BEARER_PREFIX)) {
    throw new AuthError({ message: "malformed_authorization_header" });
  }
  return authHeader.slice(BEARER_PREFIX.length);
}
