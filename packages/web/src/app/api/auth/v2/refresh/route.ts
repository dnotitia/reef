import { logger } from "@/lib/logging/logger";
import {
  AuthV2RouteRuntimeError,
  getAuthV2RouteRuntime,
} from "@/server/auth-v2/runtime";
import {
  AuthV2RouteSessionError,
  isAccountDenial,
  refreshIfNeeded,
  resolveSession,
  responseForRouteFailure,
  responseWithAuthV2Session,
  sessionHandle,
  shouldRevokeSession,
  validateSessionAccount,
} from "@/server/auth-v2/routeHelpers";

export async function POST(request: Request): Promise<Response> {
  const handle = sessionHandle(request);
  let runtime: Awaited<ReturnType<typeof getAuthV2RouteRuntime>> | undefined;
  try {
    runtime = await getAuthV2RouteRuntime();
    if (!handle) {
      throw new AuthV2RouteSessionError("auth_v2_session_missing");
    }
    const record = await resolveSession(runtime, handle);
    const refreshed = await refreshIfNeeded(runtime, handle, record);
    const account = await validateSessionAccount(runtime, refreshed);
    return responseWithAuthV2Session(account, handle, refreshed);
  } catch (error) {
    if (
      runtime &&
      handle &&
      (isAccountDenial(error) || shouldRevokeSession(error))
    ) {
      await runtime.store.revoke(handle).catch(() => undefined);
    }
    if (
      !(error instanceof AuthV2RouteRuntimeError) &&
      !(error instanceof AuthV2RouteSessionError)
    ) {
      logger.error(
        { code: "auth_v2_refresh_failed" },
        "auth_v2 refresh failed",
      );
    }
    return responseForRouteFailure(error);
  } finally {
    await runtime?.close();
  }
}
