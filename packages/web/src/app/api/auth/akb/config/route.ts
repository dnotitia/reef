import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { logger } from "@/lib/logging/logger";
import { AkbApiError, akbGetAuthConfig } from "@reef/core";

/**
 * GET /api/auth/akb/config
 *
 * Public auth capability probe for the login page. This route is intentionally
 * sessionless: it exposes whether akb has Keycloak SSO enabled and the
 * akb-owned login start URL. The akb wire schema and fetch live in core.
 */
export async function GET(_request: Request): Promise<Response> {
  let backendUrl: string;
  try {
    backendUrl = getAkbBackendUrl();
  } catch (err) {
    logger.error({ err }, "akb_auth_config: backend url missing");
    return Response.json(
      { error: "The workspace backend is not configured." },
      { status: 503 },
    );
  }

  try {
    const { config } = await akbGetAuthConfig({ baseUrl: backendUrl });
    return Response.json(config, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof AkbApiError) {
      logger.error(
        { err, status: err.status },
        "akb_auth_config: backend rejected config request",
      );
      return Response.json(
        { error: "The workspace backend rejected the request." },
        { status: 502 },
      );
    }
    throw err;
  }
}
