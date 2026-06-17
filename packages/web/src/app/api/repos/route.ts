import { extractGithubToken } from "@/lib/github/extractGithubToken";
import { logger } from "@/lib/logging/logger";
import { createGitHubAdapter, translateError } from "@reef/core";

/**
 * GET /api/repos
 *
 * Returns the authenticated user's GitHub repositories.
 * Thin Route Handler wrapper:
 *   1. Extract GitHub token from Authorization header
 *   2. Call the core GitHub adapter repo-listing method, forwarding the
 *      client's If-None-Match header so unchanged listings round-trip as 304
 *      (no payload, no rate-limit cost)
 *   3. Return { repos: Array<{ full_name: string; id: number }> } + ETag
 *      header, or 304 with ETag. `id` is GitHub's stable numeric repo id —
 *      the logical PK for `monitored_repos` rows.
 *   4. Translate core errors through PM vocabulary
 *
 * Stateless: adapter is per-request; token does not stored.
 * Logging redaction invariant: no console.log in this handler reads raw header
 * values. Error logging uses logError with status context.
 */
export async function GET(request: Request): Promise<Response> {
  // 1. Extract credentials from headers — does not from URL
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

  // 2. Call core adapter (createGitHubAdapter — per-request, no singleton)
  const adapter = createGitHubAdapter({ token });
  const ifNoneMatch = request.headers.get("If-None-Match");

  try {
    const result = await adapter.listAuthenticatedRepositories({ ifNoneMatch });

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
  } catch (err) {
    const status = getErrorStatus(err);
    logger.error({ err, status }, "list_repos failed");
    return translateError(err);
  }
}

function getErrorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null || !("status" in err)) {
    return undefined;
  }
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}
