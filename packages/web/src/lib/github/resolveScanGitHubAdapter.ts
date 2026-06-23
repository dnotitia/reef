import {
  type ResolveGitHubAdapterResult,
  resolveGitHubAdapter,
} from "@/lib/github/resolveGitHubAdapter";
import type { GitHubAdapter } from "@reef/core";

/**
 * Resolve the GitHub adapter for a monitored-repo activity scan.
 *
 * Credential selection is shared with the grounding and repo-list callers
 * through `resolveGitHubAdapter` (REEF-290 AC2): server-managed GitHub App,
 * then the dev/CI server PAT fallback, then the per-user browser PAT. The App
 * token and server PAT are deployment credentials, validated against akb
 * (`/auth/me`) before use; the browser PAT is self-authorizing.
 *
 * Both scan callers — the manual `POST /api/activity/scan` route and the
 * `agent-run` `activity.scan` task — share this resolver so they use one
 * provider (REEF-240 AC2). The result is a discriminated union rather than a
 * ready `Response` so each caller maps failures to its own contract: the manual
 * route to PM-facing JSON, the agent-run route to its structured agent error.
 */
export type ResolveScanGitHubAdapterResult =
  | { kind: "adapter"; adapter: GitHubAdapter }
  /** A deployment credential was selected but akb rejected the session; `response` is the ready 401/5xx. */
  | { kind: "session_invalid"; response: Response }
  /** No App, no server PAT, and no usable browser PAT on the Authorization header. */
  | { kind: "github_auth_required" }
  /** App configured but minting the installation token failed (perm/rate-limit). */
  | { kind: "github_error"; error: unknown };

export async function resolveScanGitHubAdapter(
  request: Request,
): Promise<ResolveScanGitHubAdapterResult> {
  const resolved: ResolveGitHubAdapterResult =
    await resolveGitHubAdapter(request);

  switch (resolved.kind) {
    case "adapter":
      return { kind: "adapter", adapter: resolved.adapter };
    case "session_invalid":
      return { kind: "session_invalid", response: resolved.response };
    case "github_app_error":
      return { kind: "github_error", error: resolved.error };
    case "no_credential":
      return { kind: "github_auth_required" };
  }
}
