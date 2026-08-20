import {
  isAkbAccountErrorCode,
  type AkbAuthV2AccountDenialCode,
} from "@reef/core";
import { logger } from "@/lib/logging/logger";
import {
  buildClearedAuthInvalidationCookie,
  buildClearedAuthCookies,
} from "@/lib/akb/sessionCookie";
import {
  AUTH_V2_STATE_COOKIE,
  buildAuthV2SessionCookie,
  buildClearedAuthV2SessionCookie,
  buildClearedAuthV2StateCookie,
  parseAuthV2StateCookie,
  readAuthV2Cookies,
} from "@/server/auth-v2/cookie";
import {
  AuthV2RouteRuntimeError,
  getAuthV2RouteRuntime,
} from "@/server/auth-v2/runtime";
import { AuthV2RouteSessionError } from "@/server/auth-v2/routeHelpers";
import type { AccountValidationError } from "@/server/auth-v2/oidcValidator";

export async function GET(request: Request): Promise<Response> {
  let runtime: Awaited<ReturnType<typeof getAuthV2RouteRuntime>> | undefined;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = readAuthV2Cookies(request);
  const stateCookie = parseAuthV2StateCookie(cookies[AUTH_V2_STATE_COOKIE]);

  if (!code || !state || !stateCookie) {
    return callbackFailure("auth_v2_state_invalid");
  }

  try {
    runtime = await getAuthV2RouteRuntime();
    const protocol = runtime.protocolFor(stateCookie.providerAlias);
    const result = await protocol.completeAuthorization({
      stateStore: runtime.stateStore,
      code,
      state,
      browserBinding: stateCookie.browserBinding,
      accountValidator: runtime.accountValidator,
    });

    const issuedAt = runtime.now();
    const absoluteExpiresAt = Math.min(
      result.tokenSet.refreshTokenExpiresAt,
      issuedAt + 31_536_000,
    );
    const session = await runtime.store.issue({
      provider_alias: result.providerAlias,
      subject: result.subject,
      session_id: result.sessionId ?? null,
      access_token: result.tokenSet.accessToken,
      refresh_token: result.tokenSet.refreshToken,
      id_token: result.tokenSet.idToken,
      issued_at: issuedAt,
      access_token_expires_at: result.tokenSet.accessTokenExpiresAt,
      absolute_expires_at: absoluteExpiresAt,
    });
    const headers = new Headers({
      Location: result.redirectPath,
      "Cache-Control": "no-store",
    });
    for (const cookie of buildClearedAuthCookies()) {
      headers.append("Set-Cookie", cookie);
    }
    headers.append("Set-Cookie", buildClearedAuthInvalidationCookie());
    headers.append(
      "Set-Cookie",
      buildAuthV2SessionCookie(
        session.handle,
        Math.max(0, session.expiresAt - issuedAt),
      ),
    );
    headers.append("Set-Cookie", buildClearedAuthV2StateCookie());
    return new Response(null, { status: 302, headers });
  } catch (error) {
    if (isAccountDenialError(error)) {
      return callbackFailure(error.code);
    }
    if (!(error instanceof AuthV2RouteRuntimeError)) {
      logger.error(
        { code: safeErrorCode(error) ?? "auth_v2_callback_failed" },
        "auth_v2_callback failed",
      );
    }
    return callbackFailure(
      error instanceof AuthV2RouteSessionError
        ? error.code
        : error instanceof AuthV2RouteRuntimeError
          ? error.code
          : "auth_v2_callback_failed",
    );
  } finally {
    await runtime?.close();
  }
}

function safeErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z0-9_]{1,96}$/u.test(error.code)
  ) {
    return error.code;
  }
  return null;
}

function isAccountDenialError(
  error: unknown,
): error is AccountValidationError & {
  code: AkbAuthV2AccountDenialCode;
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AccountValidationError" &&
    "code" in error &&
    typeof error.code === "string" &&
    isAkbAccountErrorCode(error.code)
  );
}

function callbackFailure(code: string): Response {
  const headers = new Headers({
    Location: `/login?sso_error=${encodeURIComponent(code)}`,
    "Cache-Control": "no-store",
    "X-Reef-Auth-Invalidated": "1",
  });
  for (const cookie of buildClearedAuthCookies()) {
    headers.append("Set-Cookie", cookie);
  }
  headers.append("Set-Cookie", buildClearedAuthInvalidationCookie());
  headers.append("Set-Cookie", buildClearedAuthV2SessionCookie());
  headers.append("Set-Cookie", buildClearedAuthV2StateCookie());
  return new Response(null, { status: 302, headers });
}
