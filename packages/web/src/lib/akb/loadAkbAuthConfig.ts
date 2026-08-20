import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { logger } from "@/lib/logging/logger";
import { AkbApiError, type AkbAuthConfig, akbGetAuthConfig } from "@reef/core";

/**
 * Outcome of the server-side akb auth capability probe. Either the parsed
 * Keycloak config, or a coarse failure reason the caller maps to its own
 * surface (an HTTP status for the public config route, fail-safe "render the
 * password panel" for the /login server component).
 */
export type AkbAuthConfigResult =
  | { ok: true; config: AkbAuthConfig }
  | { ok: false; reason: "backend_unconfigured" | "backend_rejected" };

/**
 * Server-side akb auth capability probe.
 *
 * The single akb-call site shared by the public `GET /api/auth/akb/config`
 * route and the `/login` server component's SSO-first auto-redirect decision
 * (REEF-312). The akb wire schema and fetch live in core (`akbGetAuthConfig`);
 * `web` consumes that result, so both surfaces stay consistent and neither
 * re-implements the akb config fetch inline.
 *
 * Expected backend problems, such as a missing `AKB_BACKEND_URL` or a rejected
 * upstream request, resolve to `{ ok: false }` so the login page can fail safe
 * (show the panel) rather than redirect into a broken SSO flow. Unexpected
 * non-`AkbApiError` failures still propagate.
 */
export async function loadAkbAuthConfig(): Promise<AkbAuthConfigResult> {
  let backendUrl: string;
  try {
    backendUrl = getAkbBackendUrl();
  } catch (err) {
    logger.error({ err }, "akb_auth_config: backend url missing");
    return { ok: false, reason: "backend_unconfigured" };
  }

  try {
    const { config } = await akbGetAuthConfig({ baseUrl: backendUrl });
    return { ok: true, config };
  } catch (err) {
    if (err instanceof AkbApiError) {
      logger.error(
        { err, status: err.status },
        "akb_auth_config: backend rejected config request",
      );
      return { ok: false, reason: "backend_rejected" };
    }
    throw err;
  }
}
