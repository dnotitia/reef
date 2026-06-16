import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import {
  SSO_LOGOUT_COOKIE,
  SSO_LOGOUT_ID_TOKEN_COOKIE,
  buildClearedAuthCookies,
  parseCookieHeader,
} from "@/lib/akb/sessionCookie";
import { logger } from "@/lib/logging/logger";
import { AkbApiError, akbStartKeycloakLogout } from "@reef/core";

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const idTokenHint = cookies[SSO_LOGOUT_ID_TOKEN_COOKIE];
  const logoutNonce = cookies[SSO_LOGOUT_COOKIE];
  const requestedNonce = requestUrl.searchParams.get("nonce");
  if (!idTokenHint || !logoutNonce || requestedNonce !== logoutNonce) {
    return invalidContinuationResponse();
  }

  let backendUrl: string;
  try {
    backendUrl = getAkbBackendUrl();
  } catch (err) {
    logger.error({ err }, "akb_sso_logout: backend url missing");
    return loginRedirect();
  }

  try {
    const { location } = await akbStartKeycloakLogout({
      baseUrl: backendUrl,
      idTokenHint,
    });
    return redirectWithCookieCleanup(location);
  } catch (err) {
    if (err instanceof AkbApiError) {
      logger.error(
        { err, status: err.status },
        "akb_sso_logout: backend rejected logout start",
      );
      return loginRedirect();
    }
    throw err;
  }
}

function loginRedirect(): Response {
  // Relative same-origin Location; request.url's host is the container bind
  // address behind the ingress (REEF-137 follow-up).
  return redirectWithCookieCleanup("/login");
}

function invalidContinuationResponse(): Response {
  return new Response(null, {
    status: 403,
    headers: { "Cache-Control": "no-store" },
  });
}

function redirectWithCookieCleanup(location: string): Response {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
  });
  for (const cookie of buildClearedAuthCookies()) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
}
