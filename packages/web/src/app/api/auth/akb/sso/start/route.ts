import {
  buildPathWithParams,
  normalizeSafeRedirect,
} from "@/lib/akb/safeRedirect";
import {
  buildAuthV2StateCookie,
  buildClearedAuthV2StateCookie,
} from "@/server/auth-v2/cookie";
import {
  AuthV2RouteRuntimeError,
  getAuthV2RouteRuntime,
} from "@/server/auth-v2/runtime";
import { logger } from "@/lib/logging/logger";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const redirectPath = normalizeSafeRedirect(url.searchParams.get("redirect"));
  const requestedProvider = url.searchParams.get("provider");
  let runtime: Awaited<ReturnType<typeof getAuthV2RouteRuntime>> | undefined;

  try {
    runtime = await getAuthV2RouteRuntime();
    const available = runtime.contract.providers.filter(
      (provider) => provider.login_url !== null,
    );
    const provider = requestedProvider
      ? available.find((candidate) => candidate.alias === requestedProvider)
      : available.length === 1
        ? available[0]
        : undefined;
    if (!provider) {
      return failureRedirect(
        available.length > 1 ? "provider_required" : "sso_unavailable",
      );
    }
    const started = await runtime
      .protocolFor(provider.alias)
      .beginAuthorization({
        stateStore: runtime.stateStore,
        redirectPath,
      });
    const headers = new Headers({
      Location: started.location,
      "Cache-Control": "no-store",
    });
    headers.append(
      "Set-Cookie",
      buildAuthV2StateCookie(provider.alias, started.browserBinding),
    );
    return new Response(null, { status: 302, headers });
  } catch (error) {
    if (!(error instanceof AuthV2RouteRuntimeError)) {
      logger.error({ code: "auth_v2_start_failed" }, "auth_v2 start failed");
    }
    return failureRedirect(
      error instanceof AuthV2RouteRuntimeError
        ? error.code
        : "sso_start_failed",
    );
  } finally {
    await runtime?.close();
  }
}
function failureRedirect(code: string): Response {
  const headers = new Headers({
    Location: buildPathWithParams("/login", { sso_error: code }),
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", buildClearedAuthV2StateCookie());
  return new Response(null, { status: 302, headers });
}
