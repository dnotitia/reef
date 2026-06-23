import { getAkbCurrentActor } from "@/lib/api/requestHelpers";
import { extractGithubToken } from "@/lib/github/extractGithubToken";
import { resolveServerGitHubAppConfig } from "@/lib/github/serverAppConfig";
import {
  AuthError,
  type GitHubAdapter,
  createGitHubAdapter,
  createGitHubAppInstallationTokenProvider,
} from "@reef/core";

/**
 * Resolve the GitHub adapter for AI **code grounding** — the read-only
 * monitored-repo `search_code` / `dev_read_file` tools wired into Ask AI
 * (`/api/chat`), enrich (`/api/enrich`), and agent runs (`/api/agents/runs`).
 * It prefers the deployment-managed GitHub App over the per-user browser PAT,
 * the same credential selection `resolveScanGitHubAdapter` introduced for the
 * activity scan in REEF-240.
 *
 *   1. **Server-managed GitHub App** — when the deployment is configured
 *      (`REEF_GITHUB_APP_*`), mint a read-only installation token so grounding
 *      runs without any browser PAT. The session is validated against akb
 *      (`/auth/me`) *before* minting, because the App path mints a deployment
 *      credential rather than consuming a caller-supplied one — without that
 *      check a forged-but-decodable session cookie could trigger a credential
 *      mint. (The PAT path is self-authorizing, so it needs no such check.)
 *   2. **Per-user browser PAT** — the fallback when no App is configured. The
 *      two paths run in parallel during the migration away from PATs
 *      (REEF-237 / REEF-238); the PAT UI is removed in a later cleanup issue.
 *
 * Unlike the scan resolver, grounding is an *enhancement*: it must never block
 * the AI request. So every way it can fail to obtain a GitHub adapter — no App
 * and no PAT, an unverified session, or a mint failure (revoked / rate-limited
 * App, missing permission) — collapses to a single `degraded` outcome, and the
 * caller continues AKB-only. This is what keeps REEF-089's AKB-only fallback
 * intact (REEF-243 AC1 / AC3) and is why a bad session degrades here rather
 * than returning a 401 the way the scan resolver does: a forged session must
 * not mint the deployment credential, but it also must not newly break a chat
 * request that previously answered AKB-only.
 *
 * Security (REEF-243 AC4): the minted installation token never leaves this
 * resolver — it is handed straight to `createGitHubAdapter` and is never placed
 * on the result, in a log line, or in an LLM prompt. A mint failure is reported
 * back as the credential-free `GitHubApiError` the provider already normalizes,
 * for server-side logging only.
 */
export type GroundingDegradeReason =
  /** No App configured and no usable browser PAT on the Authorization header. */
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
  // 1. Server-managed GitHub App path (no browser PAT required).
  const appConfig = resolveServerGitHubAppConfig();
  if (appConfig.ok) {
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

  // 2. Fallback: per-user browser PAT from the Authorization header.
  let token: string;
  try {
    token = extractGithubToken(request);
  } catch (err) {
    return err instanceof AuthError
      ? { kind: "degraded", reason: "no_credential" }
      : { kind: "degraded", reason: "no_credential", error: err };
  }
  return { kind: "adapter", adapter: createGitHubAdapter({ token }) };
}
