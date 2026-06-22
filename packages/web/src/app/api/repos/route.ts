import { getAkbCurrentActor } from "@/lib/api/requestHelpers";
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
    // Authorize before using the server-managed credential. Unlike the PAT path
    // — which is self-authorizing, since the caller lists the repos of the token
    // they themselves supply — the App path mints a deployment credential, so
    // without an auth check an unauthenticated caller could read the
    // installation's repo list (including private repo names/ids). Validate the
    // session against the akb backend (akb `/auth/me`) rather than just decoding
    // the cookie: this route never otherwise calls akb, so a syntactic
    // presence/`exp` check would accept a forged cookie. `getAkbCurrentActor`
    // returns a ready 401/5xx Response when the session is missing, expired, or
    // rejected by akb (REEF-239).
    //
    // The floor is an akb-verified session, not a per-workspace role. reef is
    // single-tenant per deployment — one akb backend, one shared Keycloak
    // tenant, and one deployment-managed GitHub App installation
    // (`REEF_GITHUB_APP_INSTALLATION_ID` is singular, with no per-org/per-vault
    // installation mechanism); the root AGENTS.md carries no multi-tenant
    // isolation contract. So an akb-verified caller is an org member, and the
    // installation's repo list is in-tenant data, trusted the same way the
    // deployment-managed LLM config is. A per-vault writer floor would solve a
    // cross-tenant problem reef does not have, and would break the create-
    // workspace flow (no vault exists yet to authorize against). Scoping the
    // installation to specific workspaces is REEF-239's deferred open question,
    // tracked for a follow-up rather than guessed here.
    const auth = await getAkbCurrentActor(request);
    if ("response" in auth) {
      return auth.response;
    }

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
