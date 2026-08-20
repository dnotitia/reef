import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { logger } from "@/lib/logging/logger";
import {
  AkbApiError,
  akbGetAuthV2Config,
  type AkbAuthV2Config,
} from "@reef/core";

/**
 * The auth-v2 capability probe has two fail-closed outcomes:
 *
 * - `contract_unavailable`: AKB cannot currently be reached/configured.
 * - `contract_mismatch`: AKB answered, but not with the explicit v2 contract.
 *
 * Neither outcome is projected into the legacy auth config.  Callers choose a
 * safe surface (normally the password panel or an operator-facing readiness
 * failure) until AKB publishes the required contract.
 */
export type AkbAuthV2ConfigResult =
  | { ok: true; config: AkbAuthV2Config }
  | { ok: false; reason: "contract_unavailable" | "contract_mismatch" };

export async function loadAkbAuthV2Config(): Promise<AkbAuthV2ConfigResult> {
  let backendUrl: string;
  try {
    backendUrl = getAkbBackendUrl();
  } catch (error) {
    logger.error({ err: error }, "akb_auth_v2_config: backend url missing");
    return { ok: false, reason: "contract_unavailable" };
  }

  try {
    const { config } = await akbGetAuthV2Config({ baseUrl: backendUrl });
    return { ok: true, config };
  } catch (error) {
    if (error instanceof AkbApiError) {
      if (
        error.status === 502 &&
        (error.context.message === "auth_v2_config_contract_mismatch" ||
          error.context.message === "auth_v2_config_non_json")
      ) {
        logger.error(
          { status: error.status },
          "akb_auth_v2_config: contract mismatch",
        );
        return { ok: false, reason: "contract_mismatch" };
      }
      logger.error(
        { status: error.status },
        "akb_auth_v2_config: contract unavailable",
      );
      return { ok: false, reason: "contract_unavailable" };
    }
    // An account-denial/AuthError or another unexpected ReefError is not a
    // valid auth-v2 catalog.  Keep the loader fail-closed and do not expose an
    // upstream response or token to its caller.
    logger.error({ err: error }, "akb_auth_v2_config: contract unavailable");
    return { ok: false, reason: "contract_unavailable" };
  }
}
