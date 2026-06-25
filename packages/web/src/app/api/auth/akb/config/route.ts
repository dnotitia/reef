import { loadAkbAuthConfig } from "@/lib/akb/loadAkbAuthConfig";

/**
 * GET /api/auth/akb/config
 *
 * Public auth capability probe for the login page. This route is intentionally
 * sessionless: it exposes whether akb has Keycloak SSO enabled and the
 * akb-owned login start URL. The akb wire schema, fetch, and backend-url
 * resolution live behind {@link loadAkbAuthConfig} (shared with the /login
 * server component's SSO-first auto-redirect, REEF-312).
 */
export async function GET(_request: Request): Promise<Response> {
  const result = await loadAkbAuthConfig();

  if (!result.ok) {
    return result.reason === "backend_unconfigured"
      ? Response.json(
          { error: "The workspace backend is not configured." },
          { status: 503 },
        )
      : Response.json(
          { error: "The workspace backend rejected the request." },
          { status: 502 },
        );
  }

  return Response.json(result.config, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
