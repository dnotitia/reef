import type { Octokit } from "@octokit/rest";
import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { NotFoundError } from "../../errors";
import { observe } from "../../observability";
import { normalizeRepositoryReadError, readHeader } from "./errors";

const tracer = trace.getTracer("@reef/core");
const MAX_REPO_LABELS = 200;

/**
 * Warn once the REST budget falls to/below this remaining count (GitHub's REST
 * budget is 5000 requests/hour for a token). Recorded as span attributes always,
 * with a dev warn line near exhaustion (REEF-271).
 */
const GITHUB_REST_RATELIMIT_WARN_REMAINING = 500;

/**
 * Record the REST `x-ratelimit-remaining` / `x-ratelimit-reset` response headers
 * on the span (always, when present) and emit one dev warn line near exhaustion.
 * Octokit lowercases response header keys; `readHeader` is case-insensitive, and
 * a hermetic/test response without the headers is a no-op (guarded on a finite
 * parsed number).
 */
function recordRestRateLimit(span: Span, repo: string, headers: unknown): void {
  const remainingRaw = readHeader(headers, "x-ratelimit-remaining");
  if (remainingRaw === null) {
    return;
  }
  const remaining = Number(remainingRaw);
  if (!Number.isFinite(remaining)) {
    return;
  }
  span.setAttribute("github.ratelimit.remaining", remaining);
  const reset = readHeader(headers, "x-ratelimit-reset");
  if (reset !== null) {
    span.setAttribute("github.ratelimit.reset", reset);
  }
  if (remaining <= GITHUB_REST_RATELIMIT_WARN_REMAINING) {
    observe(
      undefined,
      {
        repo,
        github_ratelimit_remaining: remaining,
        github_ratelimit_reset: reset ?? undefined,
      },
      "github rate limit low",
      { level: "warn" },
    );
  }
}

export interface SearchGitHubCodeParams {
  query: string;
  owner: string;
  repo: string;
  maxResults: number;
}

export interface GitHubCodeSearchResult {
  path: string;
  line: number;
  snippet: string;
}

export interface SearchGitHubCodeInternalParams extends SearchGitHubCodeParams {
  rest: Octokit;
}

export async function searchCode({
  rest,
  query,
  owner,
  repo,
  maxResults,
}: SearchGitHubCodeInternalParams): Promise<GitHubCodeSearchResult[]> {
  return tracer.startActiveSpan("github.search_code", async (span) => {
    span.setAttribute("repo", `${owner}/${repo}`);
    try {
      const response = await rest.search.code({
        q: `${query} repo:${owner}/${repo}`,
        per_page: maxResults,
        headers: { accept: "application/vnd.github.text-match+json" },
      });
      const items = response.data.items as Array<{
        path: string;
        text_matches?: Array<{ fragment?: string }>;
      }>;
      const results = items.map((item) => ({
        path: item.path,
        line: item.text_matches?.[0]?.fragment ? 1 : 0,
        snippet: item.text_matches?.[0]?.fragment ?? "",
      }));
      span.setAttribute("results.count", results.length);
      recordRestRateLimit(span, `${owner}/${repo}`, response.headers);
      span.setStatus({ code: SpanStatusCode.OK });
      return results;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw normalizeRepositoryReadError(err, "repository");
    } finally {
      span.end();
    }
  });
}

export interface ReadGitHubFileParams {
  owner: string;
  repo: string;
  path: string;
  ref?: string | null;
}

export interface GitHubFileContent {
  content: string;
  path: string;
}

export interface ReadGitHubFileInternalParams extends ReadGitHubFileParams {
  rest: Octokit;
}

export async function readFile({
  rest,
  owner,
  repo,
  path,
  ref,
}: ReadGitHubFileInternalParams): Promise<GitHubFileContent> {
  return tracer.startActiveSpan("github.read_file", async (span) => {
    span.setAttribute("repo", `${owner}/${repo}`);
    span.setAttribute("path", path);
    try {
      const response = await rest.repos.getContent({
        owner,
        repo,
        path,
        ...(ref != null ? { ref } : {}),
      });
      const rawData = response.data;
      if (!isFileContent(rawData)) {
        throw new NotFoundError({ resource: "file" });
      }
      const content = Buffer.from(
        rawData.content.replace(/\n/g, ""),
        "base64",
      ).toString("utf8");

      recordRestRateLimit(span, `${owner}/${repo}`, response.headers);
      span.setStatus({ code: SpanStatusCode.OK });
      return { content, path: rawData.path };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      if (err instanceof NotFoundError) throw err;
      throw normalizeRepositoryReadError(err, "file");
    } finally {
      span.end();
    }
  });
}

function isFileContent(data: unknown): data is {
  type: "file";
  content: string;
  path: string;
} {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as {
    type?: unknown;
    content?: unknown;
    path?: unknown;
  };
  return (
    candidate.type === "file" &&
    typeof candidate.content === "string" &&
    typeof candidate.path === "string"
  );
}

export interface RepoLabel {
  name: string;
  description: string | null;
  color: string;
}

export interface ListRepoLabelsParams {
  owner: string;
  repo: string;
}

export interface ListRepoLabelsInternalParams extends ListRepoLabelsParams {
  rest: Octokit;
}

export async function listRepoLabels({
  rest,
  owner,
  repo,
}: ListRepoLabelsInternalParams): Promise<RepoLabel[]> {
  return tracer.startActiveSpan("github.list_labels_for_repo", async (span) => {
    span.setAttribute("repo", `${owner}/${repo}`);
    try {
      const items = await rest.paginate(rest.issues.listLabelsForRepo, {
        owner,
        repo,
        per_page: 100,
      });

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
      throw normalizeRepositoryReadError(err, "repository");
    } finally {
      span.end();
    }
  });
}
