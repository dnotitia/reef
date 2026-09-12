import {
  isAkbAccountErrorCode,
  type AkbAuthV2AccountDenialCode,
} from "@reef/core";
import {
  buildClearedAuthCookies,
  buildClearedAuthInvalidationCookie,
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
import type { AccountValidationError } from "@/server/auth-v2/oidcValidator";
import { logger } from "@/lib/logging/logger";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = readAuthV2Cookies(request);
  const stateCookie = parseAuthV2StateCookie(cookies[AUTH_V2_STATE_COOKIE]);

  if (!code || !state || !stateCookie) {
    return callbackFailure("invalid_sso_state");
  }

  let runtime: Awaited<ReturnType<typeof getAuthV2RouteRuntime>> | undefined;
  try {
    runtime = await getAuthV2RouteRuntime();
    const provider = runtime.contract.providers.find(
      (candidate) =>
        candidate.alias === stateCookie.providerAlias &&
        candidate.login_url !== null,
    );
    if (!provider) return callbackFailure("provider_unavailable");

    const result = await runtime
      .protocolFor(provider.alias)
      .completeAuthorization({
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
        "auth_v2 callback failed",
      );
    }
    return callbackFailure(
      error instanceof AuthV2RouteRuntimeError
        ? error.code
        : "sso_callback_failed",
    );
  } finally {
    await runtime?.close();
  }
}
function isAccountDenialError(
  error: unknown,
): error is AccountValidationError & { code: AkbAuthV2AccountDenialCode } {
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
