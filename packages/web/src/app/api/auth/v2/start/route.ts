import { logger } from "@/lib/logging/logger";
import { normalizeSafeRedirect } from "@/lib/akb/safeRedirect";
import {
  AUTH_V2_STATE_COOKIE,
  buildAuthV2StateCookie,
} from "@/server/auth-v2/cookie";
import {
  AuthV2RouteRuntimeError,
  getAuthV2RouteRuntime,
} from "@/server/auth-v2/runtime";

export async function GET(request: Request): Promise<Response> {
  let runtime: Awaited<ReturnType<typeof getAuthV2RouteRuntime>> | undefined;
  try {
    runtime = await getAuthV2RouteRuntime();
    if (!runtime.contract.keycloak.browser_session_ready) {
      return failureRedirect("auth_v2_not_ready");
    }
    const url = new URL(request.url);
    const redirectPath = normalizeSafeRedirect(
      url.searchParams.get("redirect"),
    );
    const providerAlias =
      url.searchParams.get("provider") ?? runtime.contract.providers[0]?.alias;
    if (!providerAlias) return failureRedirect("auth_v2_provider_invalid");
    const protocol = runtime.protocolFor(providerAlias);
    const started = await protocol.beginAuthorization({
      stateStore: runtime.stateStore,
      redirectPath,
    });
    const headers = new Headers({
      Location: started.location,
      "Cache-Control": "no-store",
    });
    headers.append(
      "Set-Cookie",
      buildAuthV2StateCookie(providerAlias, started.browserBinding),
    );
    return new Response(null, { status: 302, headers });
  } catch (error) {
    if (!(error instanceof AuthV2RouteRuntimeError)) {
      logger.error({ code: "auth_v2_start_failed" }, "auth_v2_start failed");
    }
    return failureRedirect(
      error instanceof AuthV2RouteRuntimeError
        ? error.code
        : "auth_v2_start_failed",
    );
  } finally {
    await runtime?.close();
  }
}

function failureRedirect(code: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/login?sso_error=${encodeURIComponent(code)}`,
      "Cache-Control": "no-store",
      "Set-Cookie": `${AUTH_V2_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    },
  });
}
