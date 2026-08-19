import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { logger } from "@/lib/logging/logger";
import { readAuthRuntimeConfig } from "@/server/auth/config";
import { AkbApiError, type AkbAuthConfig, akbGetAuthConfig } from "@reef/core";
import { buildPathWithParams } from "./safeRedirect";

const LEGACY_KEYCLOAK_LOGIN_PATH = "/api/v1/auth/keycloak/login";
const LEGACY_SSO_PROVIDER_ALIAS = "legacy";
const LEGACY_SSO_PROVIDER_DISPLAY_NAME = "SSO";

type VersionedAkbAuthConfig = Extract<AkbAuthConfig, { schema_version: 2 }>;
type LegacyAkbAuthConfig = Exclude<AkbAuthConfig, VersionedAkbAuthConfig>;

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
    if (versioned && config.auth_mode !== reefAuth.mode) {
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
      const projected = projectLegacySsoConfig(config);
      if (!projected) {
        logger.error(
          {},
          "akb_auth_config: legacy SSO catalog cannot be projected safely",
        );
        return { ok: false, reason: "mode_mismatch" };
      }
      return { ok: true, config: projected };
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
        // SSO is the session transport, not a password-policy override. Keep
        // AKB's local-auth capability so the pre-v0.11 hybrid surface remains
        // available; an explicit SSO-only catalog continues to disable it at
        // the projection boundary below.
        providers: enabledProviders.map((provider) => ({
          ...provider,
          // Do not relay or call AKB's own browser login route. Reef owns its
          // dedicated OIDC client and uses the catalog-validated alias.
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

/**
 * Project the pre-v2, single-provider AKB catalog onto Reef's BFF contract.
 *
 * The old response only tells us that AKB's canonical Keycloak entry point is
 * enabled; it does not provide an arbitrary redirect target or a provider
 * alias. The fixed `legacy` alias is therefore the only value Reef can safely
 * bind to the OIDC transaction. The OIDC client still requires the resulting
 * access token's `identity_provider` claim to equal this alias, so deployments
 * whose Keycloak claim does not match fail closed during token validation.
 */
function projectLegacySsoConfig(
  config: LegacyAkbAuthConfig,
): VersionedAkbAuthConfig | null {
  if (
    !config.keycloak.enabled ||
    config.keycloak.login_url !== LEGACY_KEYCLOAK_LOGIN_PATH
  ) {
    return null;
  }

  return {
    schema_version: 2,
    auth_mode: "sso",
    // Preserve the legacy hybrid policy. `sso_only` is the explicit opt-out
    // from the password surface; otherwise AKB's local-auth capability stays
    // visible in the projected v2 contract.
    local_auth: {
      enabled: config.local_auth.enabled && !config.keycloak.sso_only,
    },
    // Legacy AKB has no readiness field. Reef performs its own OIDC
    // reachability and token checks; a failed check redirects to the existing
    // fail-closed SSO error path.
    keycloak: { enabled: true, browser_session_ready: true },
    providers: [
      {
        provider_type: "keycloak-oidc",
        alias: LEGACY_SSO_PROVIDER_ALIAS,
        display_name: LEGACY_SSO_PROVIDER_DISPLAY_NAME,
        login_url: buildPathWithParams("/api/auth/akb/sso/start", {
          provider: LEGACY_SSO_PROVIDER_ALIAS,
        }),
      },
    ],
  };
}
