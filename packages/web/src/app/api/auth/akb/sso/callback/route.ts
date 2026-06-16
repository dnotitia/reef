import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import {
  buildPathWithParams,
  isSafeSameOriginPath,
} from "@/lib/akb/safeRedirect";
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  SSO_START_COOKIE,
  buildClearedSsoIdTokenCookie,
  buildClearedSsoStartCookie,
  buildSessionCookie,
  buildSsoIdTokenCookie,
  buildSsoSessionCookie,
  decodeJwtExp,
  parseCookieHeader,
} from "@/lib/akb/sessionCookie";
import { logger } from "@/lib/logging/logger";
import { AkbApiError, AuthError, akbExchangeKeycloakCode } from "@reef/core";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return loginErrorRedirect("missing_code", {
      clearStartCookie: true,
    });
  }

  const startNonce = parseCookieHeader(request.headers.get("cookie"))[
    SSO_START_COOKIE
  ];
  const completionPath = parseCompletionRedirect(
    url.searchParams.get("redirect"),
    startNonce,
  );
  if (!completionPath) {
    return loginErrorRedirect("invalid_sso_state", {
      clearStartCookie: true,
    });
  }

  let backendUrl: string;
  try {
    backendUrl = getAkbBackendUrl();
  } catch (err) {
    logger.error({ err }, "akb_sso_callback: backend url missing");
    return loginErrorRedirect("backend_unconfigured", {
      clearStartCookie: true,
    });
  }

  try {
    const result = await akbExchangeKeycloakCode({ baseUrl: backendUrl, code });
    const maxAgeSeconds = sessionMaxAgeSeconds(result.token);
    const headers = new Headers({
      // Relative same-origin Location (completionPath is a validated `/...` path);
      // request.url's host is the container bind address behind the ingress
      // (REEF-137 follow-up).
      Location: completionPath,
      "Cache-Control": "no-store",
    });
    headers.append(
      "Set-Cookie",
      buildSessionCookie(result.token, { maxAgeSeconds }),
    );
    headers.append("Set-Cookie", buildSsoSessionCookie({ maxAgeSeconds }));
    if (result.kcIdToken) {
      headers.append(
        "Set-Cookie",
        buildSsoIdTokenCookie(result.kcIdToken, { maxAgeSeconds }),
      );
    } else {
      headers.append("Set-Cookie", buildClearedSsoIdTokenCookie());
    }
    headers.append("Set-Cookie", buildClearedSsoStartCookie());
    return new Response(null, { status: 302, headers });
  } catch (err) {
    if (err instanceof AuthError || err instanceof AkbApiError) {
      logger.error({ err }, "akb_sso_callback: exchange failed");
      return loginErrorRedirect("exchange_failed", {
        clearStartCookie: true,
      });
    }
    throw err;
  }
}

function parseCompletionRedirect(
  rawRedirect: string | null,
  startNonce: string | undefined,
): string | null {
  if (!startNonce || !isSafeSameOriginPath(rawRedirect)) {
    return null;
  }
  const redirectUrl = new URL(rawRedirect, "http://reef.local");
  const rawCompletionRedirect =
    redirectUrl.pathname === "/api/auth/akb/sso/callback"
      ? redirectUrl.searchParams.get("redirect")
      : rawRedirect;
  if (!isSafeSameOriginPath(rawCompletionRedirect)) {
    return null;
  }
  const completionUrl = new URL(rawCompletionRedirect, "http://reef.local");
  if (completionUrl.pathname !== "/login/sso-complete") {
    return null;
  }
  if (completionUrl.searchParams.get("state") !== startNonce) {
    return null;
  }
  const next = completionUrl.searchParams.get("next");
  if (!isSafeSameOriginPath(next)) {
    return null;
  }
  return `${completionUrl.pathname}${completionUrl.search}`;
}

function sessionMaxAgeSeconds(jwt: string): number {
  const exp = decodeJwtExp(jwt);
  const nowSec = Math.floor(Date.now() / 1000);
  return exp && exp > nowSec
    ? Math.min(exp - nowSec, DEFAULT_SESSION_MAX_AGE_SECONDS)
    : DEFAULT_SESSION_MAX_AGE_SECONDS;
}

function loginErrorRedirect(
  code: string,
  options: { clearStartCookie?: boolean } = {},
): Response {
  const headers = new Headers({
    // Relative same-origin Location; request.url's host is the container bind
    // address behind the ingress (REEF-137 follow-up).
    Location: buildPathWithParams("/login", { sso_error: code }),
    "Cache-Control": "no-store",
  });
  if (options.clearStartCookie) {
    headers.append("Set-Cookie", buildClearedSsoStartCookie());
  }
  return new Response(null, { status: 302, headers });
}
