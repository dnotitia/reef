import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { getReefPublicOrigin } from "@/lib/akb/reefPublicOrigin";
import {
  buildPathWithParams,
  isSafeSameOriginPath,
} from "@/lib/akb/safeRedirect";
import { buildClearedSsoStartCookie } from "@/lib/akb/sessionCookie";
import { logger } from "@/lib/logging/logger";
import {
  AkbApiError,
  AuthError,
  akbGetAuthConfig,
  akbStartKeycloakLogin,
} from "@reef/core";

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const callbackPath = parseCallbackPath(
    requestUrl.searchParams.get("redirect"),
  );
  if (!callbackPath) {
    return loginErrorRedirect("invalid_sso_state");
  }

  // REEF-137: when this reef deployment has a configured canonical origin, hand
  // akb an ABSOLUTE callback URL on that origin so akb's companion-origin
  // allowlist delivers the one-time code back to reef instead of akb's own SPA.
  // The origin comes from the trusted server constant — does not from the
  // request — and is prefixed onto the already same-site-validated callback
  // path, so there is no path by which a foreign absolute URL can be emitted.
  // Unset → keep the older same-site path (single-target / akb-SPA).
  let reefOrigin: string | null;
  try {
    reefOrigin = getReefPublicOrigin();
  } catch (err) {
    logger.error({ err }, "akb_sso_login: REEF_PUBLIC_ORIGIN is malformed");
    return loginErrorRedirect("sso_misconfigured");
  }
  const redirectPath = reefOrigin
    ? `${reefOrigin}${callbackPath}`
    : callbackPath;

  let backendUrl: string;
  try {
    backendUrl = getAkbBackendUrl();
  } catch (err) {
    logger.error({ err }, "akb_sso_login: backend url missing");
    return loginErrorRedirect("backend_unconfigured");
  }

  try {
    const { config } = await akbGetAuthConfig({ baseUrl: backendUrl });
    const loginUrl = config.keycloak.login_url;
    if (!config.keycloak.enabled || !loginUrl) {
      return loginErrorRedirect("sso_disabled");
    }

    const { location } = await akbStartKeycloakLogin({
      baseUrl: backendUrl,
      loginUrl,
      redirectPath,
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: location,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AuthError || err instanceof AkbApiError) {
      logger.error(
        { err, status: err instanceof AkbApiError ? err.status : undefined },
        "akb_sso_login: backend rejected login start",
      );
      return loginErrorRedirect("backend_unconfigured");
    }
    throw err;
  }
}

function parseCallbackPath(rawRedirect: string | null): string | null {
  if (!isSafeSameOriginPath(rawRedirect)) return null;
  const callbackUrl = new URL(rawRedirect, "http://reef.local");
  if (callbackUrl.pathname !== "/api/auth/akb/sso/callback") return null;
  if (!parseCompletionPath(callbackUrl.searchParams.get("redirect"))) {
    return null;
  }
  return `${callbackUrl.pathname}${callbackUrl.search}`;
}

function parseCompletionPath(rawRedirect: string | null): string | null {
  if (!isSafeSameOriginPath(rawRedirect)) return null;
  const completionUrl = new URL(rawRedirect, "http://reef.local");
  if (completionUrl.pathname !== "/login/sso-complete") return null;
  if (!completionUrl.searchParams.get("state")) return null;
  if (!isSafeSameOriginPath(completionUrl.searchParams.get("next"))) {
    return null;
  }
  return `${completionUrl.pathname}${completionUrl.search}`;
}

function loginErrorRedirect(code: string): Response {
  // Relative same-origin Location: behind the ingress `request.url`'s host is the
  // container bind address (0.0.0.0:3000), so an absolute URL would leak it
  // (REEF-137 follow-up).
  const headers = new Headers({
    Location: buildPathWithParams("/login", { sso_error: code }),
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", buildClearedSsoStartCookie());
  return new Response(null, { status: 302, headers });
}
