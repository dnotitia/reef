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

export async function GET(request: Request): Promise<Response> {
  const handle = sessionHandle(request);
  let runtime: Awaited<ReturnType<typeof getAuthV2RouteRuntime>> | undefined;
  try {
    runtime = await getAuthV2RouteRuntime();
    let record = await resolveSession(runtime, handle);
    if (!handle) throw new Error("unreachable");
    record = await refreshIfNeeded(runtime, handle, record);
    const account = await validateSessionAccount(runtime, record);
    return responseWithAuthV2Session(account, handle, record);
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
        { code: "auth_v2_session_failed" },
        "auth_v2 session failed",
      );
    }
    return responseForRouteFailure(error);
  } finally {
    await runtime?.close();
  }
}
