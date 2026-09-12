import {
  buildClearedAuthCookies,
  parseCookieHeader,
} from "@/lib/akb/sessionCookie";
import {
  AUTH_V2_LOGOUT_COOKIE,
  buildClearedAuthV2LogoutCookie,
  buildClearedAuthV2SessionCookie,
  buildClearedAuthV2StateCookie,
} from "@/server/auth-v2/cookie";
import { readAuthV2RuntimeConfig } from "@/server/auth-v2/config";

export async function GET(request: Request): Promise<Response> {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const requestedNonce = new URL(request.url).searchParams.get("nonce");
  const cookieNonce = cookies[AUTH_V2_LOGOUT_COOKIE];
  if (!requestedNonce || !cookieNonce || requestedNonce !== cookieNonce) {
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const config = readAuthV2RuntimeConfig();
    if (!config.enabled) return redirectToLogin();
    const location = new URL(`${config.issuer}/protocol/openid-connect/logout`);
    location.searchParams.set("client_id", config.clientId);
    location.searchParams.set(
      "post_logout_redirect_uri",
      `${config.publicOrigin}/login`,
    );
    const headers = clearAuthHeaders();
    headers.set("Location", location.toString());
    return new Response(null, { status: 302, headers });
  } catch {
    return redirectToLogin();
  }
}
function redirectToLogin(): Response {
  const headers = clearAuthHeaders();
  headers.set("Location", "/login");
  return new Response(null, { status: 302, headers });
}

function clearAuthHeaders(): Headers {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const cookie of buildClearedAuthCookies())
    headers.append("Set-Cookie", cookie);
  headers.append("Set-Cookie", buildClearedAuthV2SessionCookie());
  headers.append("Set-Cookie", buildClearedAuthV2StateCookie());
  headers.append("Set-Cookie", buildClearedAuthV2LogoutCookie());
  return headers;
}
