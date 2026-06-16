import { extractGithubToken } from "@/lib/github/extractGithubToken";
import { mapRequestError } from "@/lib/github/mapRequestError";
import { logger } from "@/lib/logging/logger";
import { tracer } from "@/lib/telemetry";
import { SpanStatusCode } from "@opentelemetry/api";
import { ReefError, createGitHubAdapter, translateError } from "@reef/core";

/**
 * GET /api/repos
 *
 * Returns the authenticated user's GitHub repositories.
 * Thin Route Handler wrapper:
 *   1. Extract GitHub token from Authorization header
 *   2. Call createGitHubAdapter + rest.repos.listForAuthenticatedUser,
 *      forwarding the client's If-None-Match header so unchanged listings
 *      round-trip as 304 (no payload, no rate-limit cost)
 *   3. Return { repos: Array<{ full_name: string; id: number }> } + ETag
 *      header, or 304 with ETag. `id` is GitHub's stable numeric repo id —
 *      the logical PK for `monitored_repos` rows.
 *   4. Normalize GitHub errors and translate them through core PM vocabulary
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

  // Echo the client's If-None-Match through to GitHub. On a match GitHub
  // responds 304 with no body (and Octokit throws status=304), which lets
  // the client serve its cached listing without paying the payload cost.
  const ifNoneMatch = request.headers.get("If-None-Match");

  try {
    const result = await tracer.startActiveSpan(
      "route.list_repos",
      async (span) => {
        try {
          const response = await adapter.rest.repos.listForAuthenticatedUser({
            per_page: 100,
            sort: "updated",
            headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : undefined,
          });
          span.setAttribute("repo_count", response.data.length);
          const responseHeaders = (response.headers ?? {}) as Record<
            string,
            string | undefined
          >;
          return {
            kind: "ok" as const,
            repos: response.data.map((r) => ({
              full_name: r.full_name,
              id: r.id,
            })),
            etag: responseHeaders.etag ?? null,
          };
        } catch (err) {
          // Octokit surfaces 304 as a thrown RequestError, not a normal
          // response. Catch it here so the route handler can translate it
          // into a 304 Response (which has no body but echoes the ETag).
          if (getErrorStatus(err) === 304) {
            span.setAttribute("not_modified", true);
            return {
              kind: "not_modified" as const,
              etag: getResponseEtag(err),
            };
          }
          const error = err instanceof Error ? err : new Error(String(err));
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          throw err;
        } finally {
          span.end();
        }
      },
    );

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
    const reef = err instanceof ReefError ? err : mapRequestError(err);
    logger.error({ err, status }, "list_repos failed");
    return translateError(reef ?? err);
  }
}

function getErrorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null || !("status" in err)) {
    return undefined;
  }
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function getResponseEtag(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("response" in err)) {
    return null;
  }
  const response = (err as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return null;
  if (!("headers" in response)) return null;
  const headers = (response as { headers?: unknown }).headers;
  if (typeof headers !== "object" || headers === null) return null;
  const etag = (headers as Record<string, unknown>).etag;
  return typeof etag === "string" ? etag : null;
}
