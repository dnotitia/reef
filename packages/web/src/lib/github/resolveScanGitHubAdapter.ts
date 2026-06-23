import { getAkbCurrentActor } from "@/lib/api/requestHelpers";
import { resolveServerGitHubAppConfig } from "@/lib/github/serverAppConfig";
import {
  type GitHubAdapter,
  createGitHubAdapter,
  createGitHubAppInstallationTokenProvider,
} from "@reef/core";

/**
 * Resolve the GitHub adapter for a monitored-repo activity scan, preferring the
 * deployment-managed GitHub App (REEF-240 / REEF-244).
 *
 * Mirrors the credential selection `GET /api/repos` introduced in REEF-239:
 * when `REEF_GITHUB_APP_*` is configured, mint a read-scoped installation token
 * so the scan runs without any browser-supplied token. The session is validated against
 * akb (`/auth/me`) *before* minting, because the App path mints a deployment
 * credential rather than consuming a caller-supplied one — without that check a
 * forged-but-decodable session cookie could trigger a credential mint.
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
  /** No deployment-managed GitHub App is configured. */
  | { kind: "github_app_unconfigured" }
  /** App configured but minting the installation token failed (perm/rate-limit). */
  | { kind: "github_error"; error: unknown };

export async function resolveScanGitHubAdapter(
  request: Request,
): Promise<ResolveScanGitHubAdapterResult> {
  const appConfig = resolveServerGitHubAppConfig();
  if (!appConfig.ok) {
    return { kind: "github_app_unconfigured" };
  }

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
