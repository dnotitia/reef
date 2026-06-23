import { getAkbCurrentActor } from "@/lib/api/requestHelpers";
import { extractGithubToken } from "@/lib/github/extractGithubToken";
import { resolveServerGitHubAppConfig } from "@/lib/github/serverAppConfig";
import { resolveServerGitHubPat } from "@/lib/github/serverPat";
import {
  type GitHubAdapter,
  createGitHubAdapter,
  createGitHubAppInstallationTokenProvider,
} from "@reef/core";

/**
 * Which credential produced the adapter. Repo-listing callers branch on this:
 * an App installation token can only enumerate the *installation's* repos
 * (`listInstallationRepositories`), whereas any PAT — server or browser —
 * enumerates the *authenticated* account's repos
 * (`listAuthenticatedRepositories`).
 */
export type GitHubCredentialSource = "app" | "server-pat" | "browser-pat";

/**
 * Outcome of resolving a GitHub adapter for a server-side request. One shared
 * shape so the grounding, scan, and repo-list callers each map a single
 * resolution to their own contract (REEF-290 AC2).
 */
export type ResolveGitHubAdapterResult =
  | { kind: "adapter"; adapter: GitHubAdapter; source: GitHubCredentialSource }
  /**
   * A deployment credential (App or server PAT) was selected but akb rejected
   * the session, so nothing was minted/used. `response` is the ready 401/5xx.
   */
  | { kind: "session_invalid"; response: Response }
  /** No App, no server PAT, and no usable browser PAT on the Authorization header. */
  | { kind: "no_credential" }
  /** App configured but minting the installation token failed (perm/rate-limit). */
  | { kind: "github_app_error"; error: unknown };

/**
 * Resolve the GitHub adapter for a server-side request, choosing the credential
 * in one place so the three call sites stay consistent (REEF-290 AC2). It was
 * extracted from the duplicated selection logic that lived in
 * `resolveGroundingGitHubAdapter`, `resolveScanGitHubAdapter`, and the
 * `GET /api/repos` route inline.
 *
 * Precedence — App → server PAT → browser PAT:
 *   1. **Server-managed GitHub App** (`REEF_GITHUB_APP_*`) — the production
 *      path; mints a read-scoped installation token (REEF-238).
 *   2. **Server-managed PAT** (`REEF_GITHUB_PAT`) — the dev/CI fallback when no
 *      App is configured; disabled unless the env var is set (REEF-290).
 *   3. **Per-user browser PAT** — the Authorization-header fallback.
 *
 * Security: the App token and the server PAT are *deployment* credentials, so
 * both are gated on an akb-verified session (`getAkbCurrentActor`) before use —
 * without that check a forged-but-decodable session cookie could read the
 * deployment's repo list or ground against private repos. The browser PAT is
 * *self-authorizing* (the caller can only act as the token they themselves
 * supply), so it needs no session round-trip. Minted/injected tokens never
 * leave this resolver: each is handed straight to `createGitHubAdapter` and is
 * never placed on the result, a log line, or an LLM prompt.
 */
export async function resolveGitHubAdapter(
  request: Request,
): Promise<ResolveGitHubAdapterResult> {
  // 1. Server-managed GitHub App (deployment credential, session-gated).
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
      return {
        kind: "adapter",
        adapter: createGitHubAdapter({ token }),
        source: "app",
      };
    } catch (error) {
      return { kind: "github_app_error", error };
    }
  }

  // 2. Server-managed PAT (deployment credential, session-gated). Dev/CI
  //    fallback when no App is configured; disabled unless REEF_GITHUB_PAT is
  //    set (REEF-290). Gated on the same akb session as the App path because it
  //    is likewise a deployment credential, not a caller-supplied one.
  const serverPat = resolveServerGitHubPat();
  if (serverPat) {
    const auth = await getAkbCurrentActor(request);
    if ("response" in auth) {
      return { kind: "session_invalid", response: auth.response };
    }
    return {
      kind: "adapter",
      adapter: createGitHubAdapter({ token: serverPat }),
      source: "server-pat",
    };
  }

  // 3. Per-user browser PAT from the Authorization header (self-authorizing).
  let token: string;
  try {
    token = extractGithubToken(request);
  } catch {
    // Missing or malformed Authorization header — the only thing
    // extractGithubToken throws — means no usable credential. Total by design
    // (never throws) so the grounding caller, which must degrade rather than
    // throw, can map this without its own try/catch.
    return { kind: "no_credential" };
  }
  return {
    kind: "adapter",
    adapter: createGitHubAdapter({ token }),
    source: "browser-pat",
  };
}
