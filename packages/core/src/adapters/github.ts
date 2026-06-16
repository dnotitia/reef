import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { AuthError, GitHubApiError, NotFoundError } from "../errors";

const tracer = trace.getTracer("@reef/core");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitHubAdapter {
  rest: Octokit;
  graphql: typeof graphql;
  listAuthenticatedRepositories: (
    params?: ListAuthenticatedRepositoriesParams,
  ) => Promise<ListAuthenticatedRepositoriesResult>;
}

export interface CreateGitHubAdapterParams {
  token: string;
  /**
   * Optional API base URL for hermetic tests. Production callers omit this and
   * use Octokit's default github.com endpoints.
   */
  baseUrl?: string;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Factory: create a new Octokit REST + GraphQL client pair scoped to one request.
 *
 * Called once per Route Handler invocation; does not cached at module scope. The
 * caller (Route Handler) holds the adapter for the duration of the request and
 * lets it be GC'd on return.
 *
 * Since the akb pivot, the GitHub adapter is a monitored-repo surface:
 * it grounds the AI agent against the user's source repos (commit/PR scans,
 * code search, file reads, repo labels). reef's own issues/templates/config
 * live in akb — see `./akb.ts`.
 *
 * @param token - GitHub OAuth token extracted from the request's Authorization header
 * @returns A fresh { rest, graphql } pair bound to the provided token
 */
export function createGitHubAdapter({
  token,
  baseUrl = process.env.REEF_GITHUB_API_BASE_URL,
}: CreateGitHubAdapterParams): GitHubAdapter {
  const normalizedBaseUrl = baseUrl?.replace(/\/+$/, "");
  const rest = new Octokit({
    auth: token,
    ...(normalizedBaseUrl ? { baseUrl: normalizedBaseUrl } : {}),
  });
  const boundGraphql = graphql.defaults({
    ...(normalizedBaseUrl ? { baseUrl: normalizedBaseUrl } : {}),
    headers: {
      authorization: `token ${token}`,
    },
  });
  return {
    rest,
    graphql: boundGraphql,
    listAuthenticatedRepositories: (params) =>
      listAuthenticatedRepositories({ rest, ...params }),
  };
}

// ─── listAuthenticatedRepositories ───────────────────────────────────────────

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

interface ListAuthenticatedRepositoriesInternalParams
  extends ListAuthenticatedRepositoriesParams {
  rest: Octokit;
}

async function listAuthenticatedRepositories({
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

function normalizeAuthenticatedReposError(err: unknown): Error {
  const status = getErrorStatus(err);
  if (status === 401) {
    return new AuthError({});
  }
  if (status === 404) {
    return new NotFoundError({ resource: "repository" });
  }
  return new GitHubApiError({
    status: status ?? 500,
    message: err instanceof Error ? err.message : "Unknown error",
  });
}

// ─── listLabelsForRepo ────────────────────────────────────────────────────────

export interface ListLabelsForRepoParams {
  adapter: GitHubAdapter;
  owner: string;
  repo: string;
}

export interface RepoLabel {
  name: string;
  description: string | null;
  color: string;
}

const MAX_REPO_LABELS = 200;

/**
 * Lists labels defined on a repository.
 *
 * Paginates the GitHub REST endpoint up to `MAX_REPO_LABELS` items. This is
 * retained for monitored-repo reads, but issue enrichment intentionally does
 * not use GitHub labels; it derives label context from the AKB workspace.
 *
 * Error mapping: 404 → NotFoundError, 401/403 → AuthError, other non-2xx →
 * GitHubApiError.
 */
export async function listLabelsForRepo(
  params: ListLabelsForRepoParams,
): Promise<RepoLabel[]> {
  const { adapter, owner, repo } = params;

  return tracer.startActiveSpan("github.list_labels_for_repo", async (span) => {
    span.setAttribute("repo", `${owner}/${repo}`);
    try {
      const items = await adapter.rest.paginate(
        adapter.rest.issues.listLabelsForRepo,
        { owner, repo, per_page: 100 },
      );

      const labels: RepoLabel[] = items.slice(0, MAX_REPO_LABELS).map((it) => ({
        name: it.name,
        description: it.description ?? null,
        color: it.color,
      }));

      span.setAttribute("labels.count", labels.length);
      span.setStatus({ code: SpanStatusCode.OK });
      return labels;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      const e = err as { status?: number; message?: string };
      const status = e.status ?? 500;
      if (status === 404) {
        throw new NotFoundError({ resource: "repository" });
      }
      if (status === 401 || status === 403) {
        throw new AuthError({});
      }
      throw new GitHubApiError({
        status,
        message: e.message ?? "Unknown error",
      });
    } finally {
      span.end();
    }
  });
}

function getErrorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null || !("status" in err)) {
    return undefined;
  }
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function getResponseHeader(err: unknown, name: string): string | null {
  if (typeof err !== "object" || err === null || !("response" in err)) {
    return null;
  }
  const response = (err as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return null;
  if (!("headers" in response)) return null;
  return readHeader((response as { headers?: unknown }).headers, name);
}

function readHeader(headers: unknown, name: string): string | null {
  if (typeof headers !== "object" || headers === null) return null;
  const values = headers as Record<string, unknown>;
  const direct = values[name];
  if (typeof direct === "string") return direct;
  const lower = values[name.toLowerCase()];
  return typeof lower === "string" ? lower : null;
}
