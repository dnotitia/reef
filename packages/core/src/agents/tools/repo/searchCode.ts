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

const tracer = trace.getTracer("@reef/core");
const GITHUB_SCOPE_QUALIFIER_PATTERN =
  /(^|\s)(?:repo|org|user):(?:"[^"]+"|\S+)/gi;

/**
 * Factory function — creates a per-request `search_code` AI SDK tool.
 *
 * Uses GitHub Code Search API (adapter.rest.search.code).
 * Rate limit: 30 requests/minute.
 */
export function createSearchCodeTool(adapter: GitHubAdapter) {
  return tool({
    description:
      "Search code in a GitHub repository. Returns file paths, line numbers, and code snippets matching the query. Rate limit: 30 requests/minute (GitHub Code Search API).",
    inputSchema: SearchCodeInputSchema,
    execute: async ({ query, owner, repo, maxResults }) => {
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
      const response = await adapter.rest.search.code({
        q: `${sanitizedQuery} repo:${owner}/${repo}`,
        per_page: maxResults,
        headers: { accept: "application/vnd.github.text-match+json" },
      });

      const results = response.data.items.map((item) => ({
        path: item.path,
        line: item.text_matches?.[0]?.fragment ? 1 : 0,
        snippet: item.text_matches?.[0]?.fragment ?? "",
      }));
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
      const e = err as { status?: number; message?: string };
      const status = e.status ?? 500;
      if (status === 404) {
        throw new NotFoundError({ resource: "repository" });
      }
      if (status === 401 || status === 403) {
        throw new AuthError({});
      }
      if (err instanceof SchemaValidationError) {
        throw err;
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
