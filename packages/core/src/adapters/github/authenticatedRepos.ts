import type { Octokit } from "@octokit/rest";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  getErrorStatus,
  getResponseHeader,
  normalizeAuthenticatedReposError,
  readHeader,
} from "./errors";

const tracer = trace.getTracer("@reef/core");

export interface GitHubAuthenticatedRepository {
  full_name: string;
  id: number;
}

export interface ListAuthenticatedRepositoriesParams {
  ifNoneMatch?: string | null;
}

export type ListAuthenticatedRepositoriesResult =
  | {
      kind: "ok";
      repos: GitHubAuthenticatedRepository[];
      etag: string | null;
    }
  | {
      kind: "not_modified";
      etag: string | null;
    };

export interface ListAuthenticatedRepositoriesInternalParams
  extends ListAuthenticatedRepositoriesParams {
  rest: Octokit;
}

export async function listAuthenticatedRepositories({
  rest,
  ifNoneMatch,
}: ListAuthenticatedRepositoriesInternalParams): Promise<ListAuthenticatedRepositoriesResult> {
  return tracer.startActiveSpan(
    "github.list_authenticated_repositories",
    async (span) => {
      try {
        const response = await rest.repos.listForAuthenticatedUser({
          per_page: 100,
          sort: "updated",
          headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : undefined,
        });
        span.setAttribute("repos.count", response.data.length);
        span.setStatus({ code: SpanStatusCode.OK });
        return {
          kind: "ok" as const,
          repos: response.data.map((repo) => ({
            full_name: repo.full_name,
            id: repo.id,
          })),
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
