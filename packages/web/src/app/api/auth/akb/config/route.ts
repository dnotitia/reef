import { AUTH_INVALIDATED_HEADER } from "@/lib/akb/headers";
import { loadAkbAuthConfig } from "@/lib/akb/loadAkbAuthConfig";
import {
  AUTH_INVALIDATION_COOKIE,
  buildClearedAuthInvalidationCookie,
  parseCookieHeader,
} from "@/lib/akb/sessionCookie";

/**
 * GET /api/auth/akb/config
 *
 * Public auth capability probe for the login page. This route is intentionally
 * sessionless: it exposes whether akb has Keycloak SSO enabled and the
 * akb-owned login start URL. The akb wire schema, fetch, and backend-url
 * resolution live behind {@link loadAkbAuthConfig} (shared with the /login
 * server component's SSO-first auto-redirect, REEF-312).
 */
export async function GET(request: Request): Promise<Response> {
  const result = await loadAkbAuthConfig();

  if (!result.ok) {
    const response =
      result.reason === "backend_unconfigured"
        ? Response.json(
            { error: "The workspace backend is not configured." },
            { status: 503 },
          )
        : Response.json(
            { error: "The workspace backend rejected the request." },
            { status: 502 },
          );
    return consumePendingAuthInvalidation(request, response);
  }

  return consumePendingAuthInvalidation(
    request,
    Response.json(result.config, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }),
  );
}

function consumePendingAuthInvalidation(
  request: Request,
  response: Response,
): Response {
  const marker = parseCookieHeader(request.headers.get("cookie"))[
    AUTH_INVALIDATION_COOKIE
  ];
  if (marker !== "1") return response;

  response.headers.set(AUTH_INVALIDATED_HEADER, "1");
  response.headers.set("Cache-Control", "no-store");
  response.headers.append("Set-Cookie", buildClearedAuthInvalidationCookie());
  return response;
}
