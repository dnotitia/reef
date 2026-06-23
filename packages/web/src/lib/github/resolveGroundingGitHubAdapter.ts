import { getAkbCurrentActor } from "@/lib/api/requestHelpers";
import { resolveServerGitHubAppConfig } from "@/lib/github/serverAppConfig";
import {
  type GitHubAdapter,
  createGitHubAdapter,
  createGitHubAppInstallationTokenProvider,
} from "@reef/core";

/**
 * Resolve the GitHub adapter for AI **code grounding** — the read-only
 * monitored-repo `search_code` / `dev_read_file` tools wired into Ask AI
 * (`/api/chat`), enrich (`/api/enrich`), and agent runs (`/api/agents/runs`).
 * It uses only the deployment-managed GitHub App. Browser PAT collection,
 * IndexedDB storage, and request `Authorization` forwarding were removed in
 * REEF-244.
 *
 *   1. **Server-managed GitHub App** — when the deployment is configured
 *      (`REEF_GITHUB_APP_*`), mint a read-only installation token so grounding
 *      runs without any browser-supplied token. The session is validated against akb
 *      (`/auth/me`) *before* minting, because the App path mints a deployment
 *      credential rather than consuming a caller-supplied one — without that
 *      check a forged-but-decodable session cookie could trigger a credential
 *      mint.
 *   2. **No App configured** — grounding degrades to AKB-only. There is no
 *      browser-supplied credential fallback.
 *
 * Unlike the scan resolver, grounding is an *enhancement*: it must never block
 * the AI request. So every way it can fail to obtain a GitHub adapter — no App,
 * an unverified session, or a mint failure (revoked / rate-limited App, missing
 * permission) — collapses to a single `degraded` outcome, and the caller
 * continues AKB-only. This keeps REEF-089's AKB-only fallback intact (REEF-243
 * AC1 / AC3). A forged session must not mint the deployment credential, but it
 * also must not newly break a chat request that can answer AKB-only.
 *
 * Security (REEF-243 AC4): the minted installation token never leaves this
 * resolver — it is handed straight to `createGitHubAdapter` and is never placed
 * on the result, in a log line, or in an LLM prompt. A mint failure is reported
 * back as the credential-free `GitHubApiError` the provider already normalizes,
 * for server-side logging only.
 */
export type GroundingDegradeReason =
  /** No deployment-managed GitHub App is configured. */
  | "no_credential"
  /** App configured but akb rejected the session, so no token was minted. */
  | "session_unverified"
  /** App configured but minting the installation token failed (perm/rate-limit). */
  | "github_app_error";

export type ResolveGroundingGitHubAdapterResult =
  | { kind: "adapter"; adapter: GitHubAdapter }
  | { kind: "degraded"; reason: GroundingDegradeReason; error?: unknown };

export async function resolveGroundingGitHubAdapter(
  request: Request,
): Promise<ResolveGroundingGitHubAdapterResult> {
  const appConfig = resolveServerGitHubAppConfig();
  if (!appConfig.ok) {
    return { kind: "degraded", reason: "no_credential" };
  }

  const auth = await getAkbCurrentActor(request);
  if ("response" in auth) {
    // Do not mint a deployment credential for an unverified session; degrade
    // to AKB-only. The route's own akb reads still enforce the session.
    return { kind: "degraded", reason: "session_unverified" };
  }

  try {
    const mintInstallationToken = createGitHubAppInstallationTokenProvider({
      config: appConfig.config,
    });
    const token = await mintInstallationToken();
    return { kind: "adapter", adapter: createGitHubAdapter({ token }) };
  } catch (error) {
    return { kind: "degraded", reason: "github_app_error", error };
  }
}
