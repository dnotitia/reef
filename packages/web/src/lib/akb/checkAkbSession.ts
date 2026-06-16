/**
 * Client-side probe for an active akb workspace session.
 *
 * The `__reef_session` cookie is httpOnly, so the browser does not read it
 * directly. We instead call `/api/auth/akb/me`, which the server resolves
 * from the cookie. A 2xx means the session is valid; anything else (401,
 * network failure, server down) is treated as "no session".
 *
 * Used by RootPage and OnboardingGuard to gate dashboard access without
 * trusting IndexedDB state alone — a stale GitHub PAT can outlive a cookie.
 */
export async function hasActiveAkbSession(
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/akb/me", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    return res.ok;
  } catch {
    return false;
  }
}
