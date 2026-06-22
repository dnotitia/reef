import { extractGithubToken } from "@/lib/github/extractGithubToken";
import { resolveServerGitHubAppConfig } from "@/lib/github/serverAppConfig";
import { logger } from "@/lib/logging/logger";
import {
  type GitHubAdapter,
  createGitHubAdapter,
  createGitHubAppInstallationTokenProvider,
  translateError,
} from "@reef/core";

/** The shared repo-list result shape, derived so no extra core type export is needed. */
type RepoListResult = Awaited<
  ReturnType<GitHubAdapter["listAuthenticatedRepositories"]>
>;

/**
 * GET /api/repos
 *
 * Returns the monitored-repo candidate list as
 * `{ repos: Array<{ full_name: string; id: number }> }` + an ETag header (or
 * 304 with ETag). `id` is GitHub's stable numeric repo id — the logical PK for
 * `monitored_repos` rows (REEF-239 AC4).
 *
 * Two token sources, chosen per request:
 *   1. **Server-managed GitHub App** — when the deployment is configured
 *      (`REEF_GITHUB_APP_*`), the server mints a read-only installation token
 *      and lists the installation's repositories, so the picker works without
 *      any browser PAT (REEF-239 AC1/AC2).
 *   2. **Per-user browser PAT** — the fallback when no App is configured. The
 *      two paths run in parallel during the migration away from PATs
 *      (REEF-237/REEF-238); the PAT UI is removed in a later cleanup issue.
 *
 * Thin Route Handler wrapper: it owns only credential selection and PM-facing
 * error translation; the GitHub I/O and error normalization live in core.
 * Stateless — the adapter and any minted token are per-request, never stored.
 */
export async function GET(request: Request): Promise<Response> {
  const ifNoneMatch = request.headers.get("If-None-Match");

  // 1. Server-managed GitHub App path (no browser PAT required).
  const appConfig = resolveServerGitHubAppConfig();
  if (appConfig.ok) {
    try {
      const mintInstallationToken = createGitHubAppInstallationTokenProvider({
        config: appConfig.config,
      });
      const token = await mintInstallationToken();
      const adapter = createGitHubAdapter({ token });
      const result = await adapter.listInstallationRepositories({
        ifNoneMatch,
      });
      return buildReposResponse(result);
    } catch (err) {
      return handleReposError(err);
    }
  }

  // 2. Fallback: per-user browser PAT from the Authorization header.
  let token: string;
  try {
    token = extractGithubToken(request);
  } catch {
    return Response.json(
      {
        error: "Authentication required. Please configure your GitHub token.",
      },
      { status: 401 },
    );
  }

  try {
    const adapter = createGitHubAdapter({ token });
    const result = await adapter.listAuthenticatedRepositories({ ifNoneMatch });
    return buildReposResponse(result);
  } catch (err) {
    return handleReposError(err);
  }
}

function buildReposResponse(result: RepoListResult): Response {
  if (result.kind === "not_modified") {
    const headers = new Headers();
    if (result.etag) headers.set("ETag", result.etag);
    return new Response(null, { status: 304, headers });
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  if (result.etag) headers.set("ETag", result.etag);
  return new Response(JSON.stringify({ repos: result.repos }), {
    status: 200,
    headers,
  });
}

function handleReposError(err: unknown): Response {
  const status = getErrorStatus(err);
  logger.error({ err, status }, "list_repos failed");
  return translateError(err);
}

function getErrorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null || !("status" in err)) {
    return undefined;
  }
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}
