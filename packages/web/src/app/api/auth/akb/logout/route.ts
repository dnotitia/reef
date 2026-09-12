import {
  buildClearedAuthCookies,
  buildClearedAuthInvalidationCookie,
  parseCookieHeader,
} from "@/lib/akb/sessionCookie";
import {
  AUTH_V2_SESSION_COOKIE,
  buildAuthV2LogoutCookie,
  buildClearedAuthV2LogoutCookie,
  buildClearedAuthV2SessionCookie,
  buildClearedAuthV2StateCookie,
} from "@/server/auth-v2/cookie";
import { readAuthV2RuntimeConfig } from "@/server/auth-v2/config";
import {
  getAuthV2RouteRuntime,
  type AuthV2RouteRuntime,
} from "@/server/auth-v2/runtime";
import { logger } from "@/lib/logging/logger";

export async function POST(request: Request): Promise<Response> {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  let mode: "local" | "sso";
  const runtimeConfig = (() => {
    try {
      return readAuthV2RuntimeConfig();
    } catch {
      return null;
    }
  })();
  if (!runtimeConfig) {
    return Response.json(
      { error: "auth_configuration_invalid" },
      { status: 503 },
    );
  }
  try {
    mode = runtimeConfig.mode;
  } catch {
    return Response.json(
      { error: "auth_configuration_invalid" },
      { status: 503 },
    );
  }

  if (mode === "local") {
    return clearLocalLogoutResponse();
  }
  const origin = request.headers.get("origin");
  if (
    origin &&
    runtimeConfig.enabled &&
    origin !== runtimeConfig.publicOrigin
  ) {
    return Response.json({ error: "same_origin_required" }, { status: 403 });
  }

  const handle = cookies[AUTH_V2_SESSION_COOKIE];
  if (!handle || !/^[A-Za-z0-9_-]{43}$/u.test(handle)) {
    return clearLocalLogoutResponse();
  }

  let runtime: AuthV2RouteRuntime | undefined;
  try {
    runtime = await getAuthV2RouteRuntime();
    const record = await runtime.store.resolve(handle);
    if (!record) return clearLocalLogoutResponse();

    await runtime.store.revoke(handle);
    try {
      await runtime
        .protocolFor(record.provider_alias)
        .revoke(record.refresh_token);
    } catch {
      logger.warn(
        { code: "auth_v2_logout_revocation_deferred" },
        "auth_v2 logout revocation deferred",
      );
    }

    const nonce = crypto.randomUUID();
    const headers = clearAuthHeaders();
    headers.append("Set-Cookie", buildAuthV2LogoutCookie(nonce));
    headers.set("Content-Type", "application/json");
    return new Response(
      JSON.stringify({
        redirectUrl: `/api/auth/akb/sso/logout?nonce=${encodeURIComponent(nonce)}`,
      }),
      { status: 200, headers },
    );
  } catch (error) {
    logger.error({ code: "auth_v2_logout_failed" }, "auth_v2 logout failed");
    return Response.json(
      { error: "logout_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    await runtime?.close();
  }
}

function clearLocalLogoutResponse(): Response {
  return new Response(null, { status: 204, headers: clearAuthHeaders() });
}

function clearAuthHeaders(): Headers {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const cookie of buildClearedAuthCookies())
    headers.append("Set-Cookie", cookie);
  headers.append("Set-Cookie", buildClearedAuthInvalidationCookie());
  headers.append("Set-Cookie", buildClearedAuthV2SessionCookie());
  headers.append("Set-Cookie", buildClearedAuthV2StateCookie());
  headers.append("Set-Cookie", buildClearedAuthV2LogoutCookie());
  return headers;
}
