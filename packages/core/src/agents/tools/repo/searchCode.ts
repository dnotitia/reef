import { SpanStatusCode, trace } from "@opentelemetry/api";
import { tool } from "ai";
import type { GitHubAdapter } from "../../../adapters/github";
import {
  AuthError,
  GitHubApiError,
  NotFoundError,
  SchemaValidationError,
} from "../../../errors";
import {
  BoundSearchCodeInputSchema,
  SearchCodeInputSchema,
  SearchCodeOutputSchema,
} from "../../../schemas/ai/tools";
import { type RepoRef, assertRepoAllowed } from "./allowlist";

const tracer = trace.getTracer("@reef/core");
const GITHUB_SCOPE_QUALIFIER_PATTERN =
  /(^|\s)(?:repo|org|user):(?:"[^"]+"|\S+)/gi;

/**
 * Factory function — creates a per-request `search_code` AI SDK tool.
 *
 * The LLM supplies `owner`/`repo`, so the call is constrained to
 * `allowedRepos` — the active vault's monitored repositories — before it
 * reaches GitHub. This keeps a deployment App installation token (which can
 * read more repos than the vault monitors) from grounding on an out-of-scope
 * repository (REEF-243). Rate limit: 30 requests/minute.
 */
export function createSearchCodeTool(
  adapter: GitHubAdapter,
  allowedRepos: RepoRef[],
) {
  return tool({
    description:
      "Search code in one of this workspace's monitored GitHub repositories. Returns file paths, line numbers, and code snippets matching the query. Rate limit: 30 requests/minute (GitHub Code Search API).",
    inputSchema: SearchCodeInputSchema,
    execute: async ({ query, owner, repo, maxResults }) => {
      assertRepoAllowed(allowedRepos, owner, repo);
      return executeSearchCode({ adapter, query, owner, repo, maxResults });
    },
  });
}

export function createBoundSearchCodeTool({
  adapter,
  owner,
  repo,
}: {
  adapter: GitHubAdapter;
  owner: string;
  repo: string;
}) {
  return tool({
    description:
      "Search code in the monitored GitHub repository selected by the server. Returns file paths, line numbers, and code snippets matching the query. Rate limit: 30 requests/minute (GitHub Code Search API).",
    inputSchema: BoundSearchCodeInputSchema,
    execute: async ({ query, maxResults }) => {
      return executeSearchCode({ adapter, query, owner, repo, maxResults });
    },
  });
}

async function executeSearchCode({
  adapter,
  query,
  owner,
  repo,
  maxResults,
}: {
  adapter: GitHubAdapter;
  query: string;
  owner: string;
  repo: string;
  maxResults: number;
}) {
  return tracer.startActiveSpan("reef.tool.search_code", async (span) => {
    span.setAttribute("tool.name", "search_code");
    try {
      const sanitizedQuery = stripGitHubScopeQualifiers(query);
      if (!sanitizedQuery) {
        throw new SchemaValidationError({
          field: "query",
          issues: [
            "search_code query must include search terms beyond repository scope qualifiers",
          ],
        });
      }
      const results = await adapter.searchCode({
        query: sanitizedQuery,
        owner,
        repo,
        maxResults,
      });

      const parsed = SearchCodeOutputSchema.safeParse({ results });
      if (!parsed.success) {
        throw new SchemaValidationError({
          field: "searchCodeOutput",
          issues: parsed.error.issues.map((issue) => issue.message),
        });
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return parsed.data;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      if (
        err instanceof SchemaValidationError ||
        err instanceof NotFoundError ||
        err instanceof AuthError ||
        err instanceof GitHubApiError
      ) {
        throw err;
      }
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

function stripGitHubScopeQualifiers(query: string): string {
  return query.replace(GITHUB_SCOPE_QUALIFIER_PATTERN, " ").trim();
}
