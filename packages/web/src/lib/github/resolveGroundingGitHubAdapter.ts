import {
  type ResolveGitHubAdapterResult,
  resolveGitHubAdapter,
} from "@/lib/github/resolveGitHubAdapter";
import type { GitHubAdapter } from "@reef/core";

/**
 * Resolve the GitHub adapter for AI **code grounding** — the read-only
 * monitored-repo `search_code` / `dev_read_file` tools wired into Ask AI
 * (`/api/chat`), enrich (`/api/enrich`), and agent runs (`/api/agents/runs`).
 *
 * Credential selection is shared with the scan and repo-list callers through
 * `resolveGitHubAdapter` (REEF-290 AC2): server-managed GitHub App, then the
 * dev/CI server PAT fallback, then the per-user browser PAT. The App token and
 * server PAT are deployment credentials, so both are validated against akb
 * (`/auth/me`) before use; the browser PAT is self-authorizing. The two
 * server-managed paths run in parallel with the browser PAT during the
 * migration away from PATs (REEF-237 / REEF-238); the PAT UI is removed in a
 * later cleanup issue.
 *
 * Unlike the scan resolver, grounding is an *enhancement*: it must never block
 * the AI request. So every way it can fail to obtain a GitHub adapter — no
 * credential at all, an unverified session on a deployment credential, or a
 * mint failure (revoked / rate-limited App, missing permission) — collapses to
 * a single `degraded` outcome, and the caller continues AKB-only. This is what
 * keeps REEF-089's AKB-only fallback intact (REEF-243 AC1 / AC3) and is why a
 * bad session degrades here rather than returning a 401 the way the scan
 * resolver does: a forged session must not use the deployment credential, but
 * it also must not newly break a chat request that previously answered
 * AKB-only.
 *
 * Security (REEF-243 AC4): the minted/injected token never leaves
 * `resolveGitHubAdapter` — it is handed straight to `createGitHubAdapter` and
 * is never placed on the result, in a log line, or in an LLM prompt. A mint
 * failure is reported back as the credential-free error the provider already
 * normalizes, for server-side logging only.
 */
export type GroundingDegradeReason =
  /** No App, no server PAT, and no usable browser PAT on the Authorization header. */
  | "no_credential"
  /** A deployment credential was selected but akb rejected the session. */
  | "session_unverified"
  /** App configured but minting the installation token failed (perm/rate-limit). */
  | "github_app_error";

export type ResolveGroundingGitHubAdapterResult =
  | { kind: "adapter"; adapter: GitHubAdapter }
  | { kind: "degraded"; reason: GroundingDegradeReason; error?: unknown };

export async function resolveGroundingGitHubAdapter(
  request: Request,
): Promise<ResolveGroundingGitHubAdapterResult> {
  const resolved: ResolveGitHubAdapterResult =
    await resolveGitHubAdapter(request);

  switch (resolved.kind) {
    case "adapter":
      return { kind: "adapter", adapter: resolved.adapter };
    case "session_invalid":
      // Degrade to AKB-only rather than surfacing the 401: the route's own akb
      // reads still enforce the session, and the credential was never used.
      return { kind: "degraded", reason: "session_unverified" };
    case "github_app_error":
      return {
        kind: "degraded",
        reason: "github_app_error",
        error: resolved.error,
      };
    case "no_credential":
      return { kind: "degraded", reason: "no_credential" };
  }
}
