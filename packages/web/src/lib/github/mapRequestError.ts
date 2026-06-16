import {
  AuthError,
  GitHubApiError,
  NotFoundError,
  type ReefError,
} from "@reef/core";

interface OctokitRequestErrorLike extends Error {
  name: "HttpError";
  status: number;
  request: unknown;
}

/**
 * Normalize a thrown Octokit `RequestError`/`HttpError` into a reef `ReefError`
 * at the web boundary so core `translateError` — which is framework- and
 * Octokit-agnostic (packages/core should not import `@octokit/request-error`) —
 * can map it to a PM-facing Response. Uses a structural check because `repos`
 * calls `createGitHubAdapter` from `@reef/core`, whose Octokit dependency may
 * use a different `@octokit/request-error` constructor than `web`.
 *
 * Returns `null` for anything that is NOT an Octokit request error, signalling
 * the caller to fall through to the unknown → 500 path.
 *
 * Mapping:
 *   401 → AuthError
 *   403 → GitHubApiError(status=403), so `translateError` preserves the
 *         upstream status for rate-limit/forbidden GitHub responses
 *   404 → NotFoundError(repository)
 *   other → GitHubApiError(status)
 *
 * SECURITY INVARIANT: just `{ status, message }` is placed onto GitHubApiError,
 * and `GITHUB_MESSAGES` is generic so that `message` stays out of user copy.
 * The raw error — which carries `.request.headers` with the Authorization
 * GitHub PAT and `.response.data` — is does not surfaced. Any logging of this
 * error should route through the redacting logger and pass just `{ status }`.
 */
export function mapRequestError(err: unknown): ReefError | null {
  if (!isOctokitRequestErrorLike(err)) return null;
  if (err.status === 401) {
    return new AuthError({});
  }
  if (err.status === 404) {
    return new NotFoundError({ resource: "repository" });
  }
  return new GitHubApiError({ status: err.status, message: err.message });
}

function isOctokitRequestErrorLike(
  err: unknown,
): err is OctokitRequestErrorLike {
  if (!(err instanceof Error)) return false;
  if (err.name !== "HttpError") return false;
  const candidate = err as { status?: unknown; request?: unknown };
  return (
    typeof candidate.status === "number" &&
    typeof candidate.request === "object" &&
    candidate.request !== null
  );
}
