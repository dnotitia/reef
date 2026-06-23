import {
  type GitHubCredentialSource,
  resolveGitHubAdapter,
} from "@/lib/github/resolveGitHubAdapter";
import { logger } from "@/lib/logging/logger";
import { type GitHubAdapter, translateError } from "@reef/core";

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
 * Credential selection (App → server PAT → browser PAT) is shared with the
 * grounding and scan callers via `resolveGitHubAdapter` (REEF-290 AC2). The
 * route only branches on which credential served the adapter: an App
 * installation token lists the *installation's* repositories, while any PAT —
 * the dev/CI server PAT or a per-user browser PAT — lists the *authenticated*
 * account's repositories. The deployment credentials (App, server PAT) are
 * session-gated inside the resolver, so an unauthenticated caller can never
 * read the deployment's repo list.
 *
 * Thin Route Handler wrapper: it owns only the repo-listing branch and PM-facing
 * error translation; the GitHub I/O and error normalization live in core.
 * Stateless — the adapter and any minted/injected token are per-request, not
 * stored.
 */
export async function GET(request: Request): Promise<Response> {
  const ifNoneMatch = request.headers.get("If-None-Match");

  const resolved = await resolveGitHubAdapter(request);
  switch (resolved.kind) {
    case "session_invalid":
      // A deployment credential (App or server PAT) was selected but akb
      // rejected the session — surface the ready 401/5xx so an unauthenticated
      // caller never reads the installation/server-PAT repo list.
      return resolved.response;
    case "no_credential":
      return Response.json(
        {
          error: "Authentication required. Please configure your GitHub token.",
        },
        { status: 401 },
      );
    case "github_app_error":
      return handleReposError(resolved.error);
    case "adapter":
      return listRepos(resolved.adapter, resolved.source, ifNoneMatch);
  }
}

async function listRepos(
  adapter: GitHubAdapter,
  source: GitHubCredentialSource,
  ifNoneMatch: string | null,
): Promise<Response> {
  try {
    // An App installation token can only enumerate the installation's repos;
    // any PAT (server or browser) enumerates the authenticated account's repos.
    const result =
      source === "app"
        ? await adapter.listInstallationRepositories({ ifNoneMatch })
        : await adapter.listAuthenticatedRepositories({ ifNoneMatch });
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
