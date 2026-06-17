import type { Octokit } from "@octokit/rest";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { NotFoundError } from "../../errors";
import { normalizeRepositoryReadError } from "./errors";

const tracer = trace.getTracer("@reef/core");
const MAX_REPO_LABELS = 200;

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
