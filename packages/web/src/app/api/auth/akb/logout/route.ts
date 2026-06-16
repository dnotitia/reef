import {
  SSO_ID_TOKEN_COOKIE,
  SSO_SESSION_COOKIE,
  buildClearedAuthCookies,
  buildClearedReefSessionCookies,
  buildSsoLogoutCookie,
  buildSsoLogoutIdTokenCookie,
  parseCookieHeader,
} from "@/lib/akb/sessionCookie";

/**
 * POST /api/auth/akb/logout
 *
 * Clears the reef auth cookies. akb has no logout endpoint and does not revoke
 * JWTs server-side, so we does not invalidate the token itself, but clearing the
 * httpOnly cookies removes their delivery vehicle.
 */
export async function POST(request: Request): Promise<Response> {
  const headers = new Headers();
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const idTokenHint = cookies[SSO_ID_TOKEN_COOKIE];
  const shouldContinueToSsoLogout =
    cookies[SSO_SESSION_COOKIE] === "1" && Boolean(idTokenHint);
  const clearedCookies = shouldContinueToSsoLogout
    ? buildClearedReefSessionCookies()
    : buildClearedAuthCookies();
  for (const cookie of clearedCookies) {
    headers.append("Set-Cookie", cookie);
  }
  headers.append("Cache-Control", "no-store");

  if (!shouldContinueToSsoLogout || !idTokenHint) {
    return new Response(null, { status: 204, headers });
  }

  const logoutNonce = crypto.randomUUID();
  headers.append("Set-Cookie", buildSsoLogoutCookie(logoutNonce));
  headers.append("Set-Cookie", buildSsoLogoutIdTokenCookie(idTokenHint));
  headers.set("Content-Type", "application/json");
  return new Response(
    JSON.stringify({
      redirectUrl: `/api/auth/akb/sso/logout?nonce=${encodeURIComponent(
        logoutNonce,
      )}`,
    }),
    {
      status: 200,
      headers,
    },
  );
}
