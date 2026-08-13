import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { extractSsoSessionHandle } from "@/lib/akb/extractAkbSession";
import {
  AUTH_ACCOUNT_ERROR_HEADER,
  AUTH_INVALIDATED_HEADER,
} from "@/lib/akb/headers";
import { buildPathWithParams } from "@/lib/akb/safeRedirect";
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  SSO_START_COOKIE,
  buildAuthInvalidationCookie,
  buildClearedAuthInvalidationCookie,
  buildClearedEstablishedAuthCookies,
  buildClearedSsoCookies,
  buildSsoSessionHandleCookie,
  parseCookieHeader,
} from "@/lib/akb/sessionCookie";
import { logger } from "@/lib/logging/logger";
import type { CompletedAuthorization } from "@/server/auth/oidcClient";
import { getSsoAuthRuntime } from "@/server/auth/runtime";
import {
  AuthError,
  akbGetMe,
  createAkbAdapter,
  isAkbAccountErrorCode,
} from "@reef/core";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  const browserBinding = parseCookieHeader(request.headers.get("cookie"))[
    SSO_START_COOKIE
  ];
  if (providerError || !code || !state || !browserBinding) {
    return loginErrorRedirect("invalid_sso_state", { clearStartCookie: true });
  }

  let runtime: Awaited<ReturnType<typeof getSsoAuthRuntime>>;
  let completed: CompletedAuthorization;
  try {
    runtime = await getSsoAuthRuntime();
    completed = await runtime.oidc.completeAuthorization(runtime.repository, {
      code,
      state,
      browserBinding,
    });
  } catch {
    logger.error({}, "reef_sso_callback: OIDC completion failed");
    return loginErrorRedirect("sso_failed", { clearStartCookie: true });
  }

  let backendUrl: string;
  try {
    backendUrl = getAkbBackendUrl();
  } catch {
    await discardCompletedAuthorization(completed, runtime);
    logger.error({}, "reef_sso_callback: backend URL missing");
    return loginErrorRedirect("backend_unconfigured", {
      clearStartCookie: true,
    });
  }

  try {
    await akbGetMe({
      adapter: createAkbAdapter({
        baseUrl: backendUrl,
        accessToken: completed.tokenSet.accessToken,
      }),
    });
  } catch (err) {
    if (
      err instanceof AuthError &&
      err.context.origin === "akb" &&
      isAkbAccountErrorCode(err.context.code)
    ) {
      await invalidateExistingSession(request, runtime);
      await discardCompletedAuthorization(completed, runtime);
      return loginErrorRedirect(err.context.code, {
        clearStartCookie: true,
        clearEstablishedAuth: true,
      });
    }
    if (
      err instanceof AuthError &&
      err.context.origin === "akb" &&
      err.context.status === 401
    ) {
      await invalidateExistingSession(request, runtime);
      await discardCompletedAuthorization(completed, runtime);
      return loginErrorRedirect("account_validation_failed", {
        clearStartCookie: true,
        clearEstablishedAuth: true,
      });
    }
    await discardCompletedAuthorization(completed, runtime);
    logger.error({}, "reef_sso_callback: AKB account projection failed");
    return loginErrorRedirect("account_validation_failed", {
      clearStartCookie: true,
    });
  }

  let handle: string;
  try {
    handle = await runtime.sessions.createSession(completed);
  } catch {
    await discardCompletedAuthorization(completed, runtime);
    logger.error({}, "reef_sso_callback: session persistence failed");
    return loginErrorRedirect("session_unavailable", {
      clearStartCookie: true,
    });
  }

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const maxAgeSeconds = Math.min(
    DEFAULT_SESSION_MAX_AGE_SECONDS,
    Math.max(
      1,
      (completed.tokenSet.refreshTokenExpiresAt ??
        nowSeconds + DEFAULT_SESSION_MAX_AGE_SECONDS) - nowSeconds,
    ),
  );
  const headers = new Headers({
    Location: buildPathWithParams("/login/sso-complete", {
      next: completed.redirectPath,
    }),
    "Cache-Control": "no-store",
  });
  for (const cookie of buildClearedSsoCookies()) {
    headers.append("Set-Cookie", cookie);
  }
  headers.append("Set-Cookie", buildClearedAuthInvalidationCookie());
  headers.append(
    "Set-Cookie",
    buildSsoSessionHandleCookie(handle, { maxAgeSeconds }),
  );
  return new Response(null, { status: 302, headers });
}

async function discardCompletedAuthorization(
  completed: CompletedAuthorization,
  runtime: Awaited<ReturnType<typeof getSsoAuthRuntime>>,
): Promise<void> {
  const refreshToken = completed.tokenSet.refreshToken;
  if (!refreshToken) return;
  try {
    await runtime.oidc.revokeRefreshToken(refreshToken);
  } catch {
    // The token never entered a Reef session; expiry is the final fallback.
  }
}

async function invalidateExistingSession(
  request: Request,
  runtime: Awaited<ReturnType<typeof getSsoAuthRuntime>>,
): Promise<void> {
  try {
    await runtime.sessions.invalidate(extractSsoSessionHandle(request));
  } catch {
    // No established opaque session to invalidate.
  }
}

function loginErrorRedirect(
  code: string,
  options: {
    clearStartCookie?: boolean;
    clearEstablishedAuth?: boolean;
  } = {},
): Response {
  const headers = new Headers({
    Location: buildPathWithParams("/login", { sso_error: code }),
    "Cache-Control": "no-store",
  });
  if (options.clearStartCookie) {
    for (const cookie of buildClearedSsoCookies()) {
      headers.append("Set-Cookie", cookie);
    }
  }
  if (options.clearEstablishedAuth) {
    headers.set(AUTH_INVALIDATED_HEADER, "1");
    if (isAkbAccountErrorCode(code)) {
      headers.set(AUTH_ACCOUNT_ERROR_HEADER, code);
    }
    for (const cookie of buildClearedEstablishedAuthCookies()) {
      headers.append("Set-Cookie", cookie);
    }
    headers.append("Set-Cookie", buildAuthInvalidationCookie());
  }
  return new Response(null, { status: 302, headers });
}
