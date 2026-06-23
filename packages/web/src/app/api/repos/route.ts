import { getAkbCurrentActor } from "@/lib/api/requestHelpers";
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
 * Requires the deployment-managed GitHub App. Browser PAT collection, IndexedDB
 * storage, and request `Authorization` forwarding were removed in REEF-244, so
 * deployments without `REEF_GITHUB_APP_*` get a clear 503 instead of a token
 * prompt.
 *
 * Thin Route Handler wrapper: it owns credential selection and PM-facing
 * error translation; the GitHub I/O and error normalization live in core.
 * Stateless — the adapter and any minted token are per-request, not stored.
 */
export async function GET(request: Request): Promise<Response> {
  const ifNoneMatch = request.headers.get("If-None-Match");

  const appConfig = resolveServerGitHubAppConfig();
  if (!appConfig.ok) {
    return Response.json(
      {
        error: "GitHub App is not configured for this deployment.",
      },
      { status: 503 },
    );
  }

  // Authorize before using the server-managed credential. The App path mints a
  // deployment credential, so without an auth check an unauthenticated caller
  // could read the installation's repo list (including private repo names/ids).
  // Validate the session against the akb backend (akb `/auth/me`) rather than
  // just decoding the cookie: this route does not otherwise call akb, so a
  // syntactic presence/`exp` check would accept a forged cookie.
  //
  // The floor is an akb-verified session, not a per-workspace role. reef is
  // single-tenant per deployment — one akb backend, one shared Keycloak tenant,
  // and one deployment-managed GitHub App installation
  // (`REEF_GITHUB_APP_INSTALLATION_ID` is singular, with no per-org/per-vault
  // installation mechanism); the root AGENTS.md carries no multi-tenant
  // isolation contract. So an akb-verified caller is an org member, and the
  // installation's repo list is in-tenant data, trusted the same way the
  // deployment-managed LLM config is. Scoping the installation to specific
  // workspaces is REEF-239's deferred open question, tracked for follow-up.
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
    const result = await adapter.listInstallationRepositories({ ifNoneMatch });
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
