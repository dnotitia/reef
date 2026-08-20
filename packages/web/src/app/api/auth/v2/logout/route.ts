import { logger } from "@/lib/logging/logger";
import {
  buildClearedAuthInvalidationCookie,
  buildClearedAuthCookies,
} from "@/lib/akb/sessionCookie";
import {
  buildClearedAuthV2SessionCookie,
  buildClearedAuthV2StateCookie,
} from "@/server/auth-v2/cookie";
import { getAuthV2RouteRuntime } from "@/server/auth-v2/runtime";
import { sessionHandle } from "@/server/auth-v2/routeHelpers";

export async function POST(request: Request): Promise<Response> {
  const handle = sessionHandle(request);
  let runtime: Awaited<ReturnType<typeof getAuthV2RouteRuntime>> | undefined;
  try {
    runtime = await getAuthV2RouteRuntime();
    if (handle) {
      const record = await runtime.store.resolve(handle);
      await runtime.store.revoke(handle);
      if (record?.refresh_token) {
        try {
          await runtime
            .protocolFor(record.provider_alias)
            .revoke(record.refresh_token);
        } catch {
          logger.warn(
            { code: "auth_v2_revocation_unavailable" },
            "auth_v2 logout revocation unavailable",
          );
        }
      }
    }
  } catch {
    // Local revocation/cookie cleanup is still completed when the deployment
    // dependencies are unavailable. The browser cannot reuse the handle.
  } finally {
    await runtime?.close();
  }

  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Reef-Auth-Invalidated": "1",
  });
  for (const cookie of buildClearedAuthCookies()) {
    headers.append("Set-Cookie", cookie);
  }
  headers.append("Set-Cookie", buildClearedAuthInvalidationCookie());
  headers.append("Set-Cookie", buildClearedAuthV2SessionCookie());
  headers.append("Set-Cookie", buildClearedAuthV2StateCookie());
  return new Response(null, { status: 204, headers });
}
