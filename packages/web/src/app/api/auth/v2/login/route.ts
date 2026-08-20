import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  buildClearedAuthCookies,
  buildClearedAuthInvalidationCookie,
  buildSessionCookie,
  decodeJwtExp,
} from "@/lib/akb/sessionCookie";
import { loadAkbAuthV2Config } from "@/lib/akb/loadAkbAuthV2Config";
import {
  requireAuthV2RuntimeConfig,
  AuthV2ConfigurationError,
} from "@/server/auth-v2/config";
import {
  buildClearedAuthV2SessionCookie,
  buildClearedAuthV2StateCookie,
} from "@/server/auth-v2/cookie";
import { logger } from "@/lib/logging/logger";
import {
  AkbApiError,
  AuthError,
  akbLogin,
  isAkbAccountErrorCode,
} from "@reef/core";
import { z } from "zod";

const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Auth-v2's optional local/password surface is an explicit AKB capability.
 * It uses a separate route and performs a fresh v2 catalog check so a hidden
 * form cannot bypass an AKB deployment that has disabled local auth. The
 * resulting credential is still the AKB-issued v1 JWT; OIDC sessions never
 * share or fall back to this route.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    requireAuthV2RuntimeConfig();
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AuthV2ConfigurationError
            ? error.code
            : "auth_v2_disabled",
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const parsed = LoginRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Username and password are required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const catalog = await loadAkbAuthV2Config();
  if (!catalog.ok || !catalog.config.local_auth.enabled) {
    return Response.json(
      { error: "auth_v2_local_auth_disabled" },
      {
        status: catalog.ok ? 404 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  let backendUrl: string;
  try {
    backendUrl = getAkbBackendUrl();
  } catch {
    return Response.json(
      { error: "The workspace backend is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await akbLogin({
      baseUrl: backendUrl,
      username: parsed.data.username,
      password: parsed.data.password,
    });
    const exp = decodeJwtExp(result.token);
    const now = Math.floor(Date.now() / 1_000);
    const maxAgeSeconds =
      exp && exp > now
        ? Math.min(exp - now, DEFAULT_SESSION_MAX_AGE_SECONDS)
        : DEFAULT_SESSION_MAX_AGE_SECONDS;
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    });
    headers.append(
      "Set-Cookie",
      buildSessionCookie(result.token, { maxAgeSeconds }),
    );
    headers.append("Set-Cookie", buildClearedAuthInvalidationCookie());
    headers.append("Set-Cookie", buildClearedAuthV2SessionCookie());
    headers.append("Set-Cookie", buildClearedAuthV2StateCookie());
    return new Response(JSON.stringify({ user: result.user }), {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof AuthError && error.context.origin === "akb") {
      if (isAkbAccountErrorCode(error.context.code)) {
        return Response.json(
          { error: error.context.code },
          {
            status: error.context.status ?? 403,
            headers: clearAllAuthCookies(),
          },
        );
      }
      return Response.json(
        { error: "Invalid username or password." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof AkbApiError) {
      logger.error(
        { status: error.status },
        "auth_v2_login: backend rejected request",
      );
      return Response.json(
        { error: "The workspace backend rejected the request." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    logger.error({ code: "auth_v2_login_failed" }, "auth_v2_login failed");
    return Response.json(
      { error: "The workspace backend is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function clearAllAuthCookies(): Headers {
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
  return headers;
}
