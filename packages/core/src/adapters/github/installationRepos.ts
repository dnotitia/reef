import type { Octokit } from "@octokit/rest";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import type {
  GitHubAuthenticatedRepository,
  ListAuthenticatedRepositoriesParams,
  ListAuthenticatedRepositoriesResult,
} from "./authenticatedRepos";
import {
  getErrorStatus,
  getResponseHeader,
  normalizeAuthenticatedReposError,
  readHeader,
} from "./errors";

const tracer = trace.getTracer("@reef/core");

/**
 * Repo-list read for a deployment-managed GitHub App installation token.
 *
 * An installation token is not a user token — it lists the repositories the App
 * installation can reach via `GET /installation/repositories`. It feeds the
 * same `createGitHubAdapter` and returns the identical route-safe wire shape
 * (`{ full_name, id }` + ETag), so the persisted `monitored_repos` projection
 * — stable numeric `github_id`, owner/name — is unchanged regardless of which
 * token sourced the listing (REEF-239 AC4).
 */
export type ListInstallationRepositoriesParams =
  ListAuthenticatedRepositoriesParams;

export type ListInstallationRepositoriesResult =
  ListAuthenticatedRepositoriesResult;

export interface ListInstallationRepositoriesInternalParams
  extends ListInstallationRepositoriesParams {
  rest: Octokit;
}

export async function listInstallationRepositories({
  rest,
  ifNoneMatch,
}: ListInstallationRepositoriesInternalParams): Promise<ListInstallationRepositoriesResult> {
  return tracer.startActiveSpan(
    "github.list_installation_repositories",
    async (span) => {
      try {
        const response = await rest.apps.listReposAccessibleToInstallation({
          per_page: 100,
          headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : undefined,
        });
        // `GET /installation/repositories` wraps the array in
        // `{ total_count, repositories }`, unlike `/user/repos` which returns a
        // bare array — read the nested list before mapping to the wire shape.
        const repositories: GitHubAuthenticatedRepository[] =
          response.data.repositories.map((repo) => ({
            full_name: repo.full_name,
            id: repo.id,
          }));
        span.setAttribute("repos.count", repositories.length);
        span.setStatus({ code: SpanStatusCode.OK });
        return {
          kind: "ok" as const,
          repos: repositories,
          etag: readHeader(response.headers, "etag"),
        };
      } catch (err) {
        if (getErrorStatus(err) === 304) {
          span.setAttribute("not_modified", true);
          span.setStatus({ code: SpanStatusCode.OK });
          return {
            kind: "not_modified" as const,
            etag: getResponseHeader(err, "etag"),
          };
        }

        const error = err instanceof Error ? err : new Error(String(err));
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });

        throw normalizeAuthenticatedReposError(err);
      } finally {
        span.end();
      }
    },
  );
}
