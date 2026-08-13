import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { logger } from "@/lib/logging/logger";
import { readAuthRuntimeConfig } from "@/server/auth/config";
import { AkbApiError, type AkbAuthConfig, akbGetAuthConfig } from "@reef/core";
import { buildPathWithParams } from "./safeRedirect";

/**
 * Outcome of the server-side akb auth capability probe. Either the parsed
 * Keycloak config, or a coarse failure reason the caller maps to its own
 * surface (an HTTP status for the public config route, fail-safe "render the
 * password panel" for the /login server component).
 */
export type AkbAuthConfigResult =
  | { ok: true; config: AkbAuthConfig }
  | {
      ok: false;
      reason:
        | "auth_unconfigured"
        | "backend_unconfigured"
        | "backend_rejected"
        | "mode_mismatch";
    };

/**
 * Server-side akb auth capability probe.
 *
 * The single akb-call site shared by the public `GET /api/auth/akb/config`
 * route and the `/login` server component's mode-aware auto-redirect decision
 * (REEF-312). The akb wire schema and fetch live in core (`akbGetAuthConfig`);
 * `web` consumes that result, so both surfaces stay consistent and neither
 * re-implements the akb config fetch inline.
 *
 * Expected backend problems, such as a missing `AKB_BACKEND_URL` or a rejected
 * upstream request, resolve to `{ ok: false }` so the login page can fail safe
 * rather than redirect into a broken SSO flow. Unexpected non-`AkbApiError`
 * failures still propagate.
 */
export async function loadAkbAuthConfig(): Promise<AkbAuthConfigResult> {
  let reefAuth: ReturnType<typeof readAuthRuntimeConfig>;
  try {
    reefAuth = readAuthRuntimeConfig();
  } catch (err) {
    logger.error({ err }, "akb_auth_config: Reef auth config invalid");
    return { ok: false, reason: "auth_unconfigured" };
  }

  let backendUrl: string;
  try {
    backendUrl = getAkbBackendUrl();
  } catch (err) {
    logger.error({ err }, "akb_auth_config: backend url missing");
    return { ok: false, reason: "backend_unconfigured" };
  }

  try {
    const { config } = await akbGetAuthConfig({ baseUrl: backendUrl });
    const versioned = "schema_version" in config;
    if (
      (versioned && config.auth_mode !== reefAuth.mode) ||
      (!versioned && reefAuth.mode === "sso")
    ) {
      logger.error(
        { reef_mode: reefAuth.mode },
        "akb_auth_config: Reef and AKB auth modes disagree",
      );
      return { ok: false, reason: "mode_mismatch" };
    }
    if (reefAuth.mode === "local") {
      return "schema_version" in config
        ? {
            ok: true,
            config: {
              ...config,
              keycloak: { enabled: false, browser_session_ready: false },
              providers: [],
            },
          }
        : {
            ok: true,
            config: {
              ...config,
              keycloak: {
                ...config.keycloak,
                enabled: false,
                login_url: null,
                sso_only: false,
              },
            },
          };
    }
    if (!("schema_version" in config)) {
      return { ok: false, reason: "mode_mismatch" };
    }
    if (!config.keycloak.enabled || !config.keycloak.browser_session_ready) {
      return { ok: false, reason: "mode_mismatch" };
    }
    const enabledProviders = config.providers.filter(
      (provider) => provider.login_url !== null,
    );
    return {
      ok: true,
      config: {
        ...config,
        // Mode selection is Reef-owned. Never expose a password form while
        // the BFF is configured to accept only opaque SSO sessions.
        local_auth: { enabled: false },
        providers: enabledProviders.map((provider) => ({
          ...provider,
          // Never relay or call AKB's own browser login route. Reef owns its
          // dedicated OIDC client and uses only the catalog-validated alias.
          login_url: buildPathWithParams("/api/auth/akb/sso/start", {
            provider: provider.alias,
          }),
        })),
      },
    };
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
