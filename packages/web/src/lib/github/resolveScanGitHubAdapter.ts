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
 * Resolve the GitHub adapter for a monitored-repo activity scan, preferring the
 * deployment-managed GitHub App over the per-user browser PAT (REEF-240).
 *
 * Mirrors the credential selection `GET /api/repos` introduced in REEF-239:
 *   1. **Server-managed GitHub App** — when the deployment is configured
 *      (`REEF_GITHUB_APP_*`), mint a read-only installation token so the scan
 *      runs without any browser PAT. The session is validated against akb
 *      (`/auth/me`) *before* minting, because the App path mints a deployment
 *      credential rather than consuming a caller-supplied one — without that
 *      check a forged-but-decodable session cookie could trigger a credential
 *      mint. (The PAT path is self-authorizing, so it needs no such check.)
 *   2. **Per-user browser PAT** — the fallback when no App is configured. The
 *      two paths run in parallel during the migration away from PATs
 *      (REEF-237/REEF-238); the PAT UI is removed in a later cleanup issue.
 *
 * Both scan callers — the manual `POST /api/activity/scan` route and the
 * `agent-run` `activity.scan` task — share this resolver so they use one
 * provider (REEF-240 AC2). The result is a discriminated union rather than a
 * ready `Response` so each caller maps failures to its own contract: the manual
 * route to PM-facing JSON, the agent-run route to its structured agent error.
 */
export type ResolveScanGitHubAdapterResult =
  | { kind: "adapter"; adapter: GitHubAdapter }
  /** akb rejected the session on the App path; `response` is the ready 401/5xx. */
  | { kind: "session_invalid"; response: Response }
  /** No App configured and no usable browser PAT on the Authorization header. */
  | { kind: "github_auth_required" }
  /** App configured but minting the installation token failed (perm/rate-limit). */
  | { kind: "github_error"; error: unknown };

export async function resolveScanGitHubAdapter(
  request: Request,
): Promise<ResolveScanGitHubAdapterResult> {
  // 1. Server-managed GitHub App path (no browser PAT required).
  const appConfig = resolveServerGitHubAppConfig();
  if (appConfig.ok) {
    const auth = await getAkbCurrentActor(request);
    if ("response" in auth) {
      return { kind: "session_invalid", response: auth.response };
    }

    try {
      const mintInstallationToken = createGitHubAppInstallationTokenProvider({
        config: appConfig.config,
      });
      const token = await mintInstallationToken();
      return { kind: "adapter", adapter: createGitHubAdapter({ token }) };
    } catch (error) {
      return { kind: "github_error", error };
    }
  }

  // 2. Fallback: per-user browser PAT from the Authorization header.
  let token: string;
  try {
    token = extractGithubToken(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return { kind: "github_auth_required" };
    }
    throw err;
  }
  return { kind: "adapter", adapter: createGitHubAdapter({ token }) };
}
