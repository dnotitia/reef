import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import {
  buildPathWithParams,
  normalizeSafeRedirect,
} from "@/lib/akb/safeRedirect";
import { buildSsoStartCookie } from "@/lib/akb/sessionCookie";
import { logger } from "@/lib/logging/logger";
import { AkbApiError, akbGetAuthConfig } from "@reef/core";

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const nextPath = normalizeSafeRedirect(
    requestUrl.searchParams.get("redirect"),
  );
  const nonce = crypto.randomUUID();
  const completionPath = buildPathWithParams("/login/sso-complete", {
    state: nonce,
    next: nextPath,
  });
  const callbackPath = buildPathWithParams("/api/auth/akb/sso/callback", {
    redirect: completionPath,
  });

  let backendUrl: string;
  try {
    backendUrl = getAkbBackendUrl();
  } catch (err) {
    logger.error({ err }, "akb_sso_start: backend url missing");
    return loginErrorRedirect("backend_unconfigured");
  }

  try {
    const { config } = await akbGetAuthConfig({ baseUrl: backendUrl });
    const loginUrl = config.keycloak.login_url;
    if (!config.keycloak.enabled || !loginUrl) {
      return loginErrorRedirect("sso_disabled");
    }

    // Same-origin redirect: emit a RELATIVE Location so the browser resolves it
    // against the user's public origin. Behind the ingress, `request.url`'s host
    // is the container's internal bind address (0.0.0.0:3000), not the public
    // host — an absolute Location here would send the browser to 0.0.0.0:3000
    // (REEF-137 follow-up).
    const proxyPath = buildPathWithParams("/api/auth/akb/sso/login", {
      redirect: callbackPath,
    });

    const headers = new Headers({
      Location: proxyPath,
      "Cache-Control": "no-store",
    });
    headers.append("Set-Cookie", buildSsoStartCookie(nonce));
    return new Response(null, { status: 302, headers });
  } catch (err) {
    if (err instanceof AkbApiError) {
      logger.error(
        { err, status: err.status },
        "akb_sso_start: backend rejected config request",
      );
      return loginErrorRedirect("backend_unconfigured");
    }
    throw err;
  }
}

function loginErrorRedirect(code: string): Response {
  // Relative same-origin Location (see the proxyPath note above).
  return new Response(null, {
    status: 302,
    headers: {
      Location: buildPathWithParams("/login", { sso_error: code }),
      "Cache-Control": "no-store",
    },
  });
}
