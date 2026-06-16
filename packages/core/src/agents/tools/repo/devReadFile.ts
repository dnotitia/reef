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
  BoundDevReadFileInputSchema,
  DevReadFileInputSchema,
  type DevReadFileOutput,
  DevReadFileOutputSchema,
} from "../../../schemas/ai/tools";

const tracer = trace.getTracer("@reef/core");

/**
 * Factory function — creates a per-request `dev_read_file` AI SDK tool.
 *
 * Uses GitHub Contents API (adapter.rest.repos.getContent).
 * Supports optional line range slicing.
 */
export function createDevReadFileTool(adapter: GitHubAdapter) {
  return tool({
    description:
      "Read the contents of a file from a GitHub repository. Supports optional line range. Returns file content and whether it was truncated.",
    inputSchema: DevReadFileInputSchema,
    execute: async ({ owner, repo, path, ref, startLine, endLine }) => {
      return executeDevReadFile({
        adapter,
        owner,
        repo,
        path,
        ref,
        startLine,
        endLine,
      });
    },
  });
}

export function createBoundDevReadFileTool({
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
      "Read a file from the monitored GitHub repository selected by the server. Supports optional line range. Returns file content and whether it was truncated.",
    inputSchema: BoundDevReadFileInputSchema,
    execute: async ({ path, ref, startLine, endLine }) => {
      return executeDevReadFile({
        adapter,
        owner,
        repo,
        path,
        ref,
        startLine,
        endLine,
      });
    },
  });
}

async function executeDevReadFile({
  adapter,
  owner,
  repo,
  path,
  ref,
  startLine,
  endLine,
}: {
  adapter: GitHubAdapter;
  owner: string;
  repo: string;
  path: string;
  ref: string | null;
  startLine: number | null;
  endLine: number | null;
}): Promise<DevReadFileOutput> {
  // Path traversal guard
  if (path.includes("..")) {
    throw new SchemaValidationError({
      field: "path",
      issues: ["Path must not contain directory traversal sequences"],
    });
  }

  return tracer.startActiveSpan("reef.tool.dev_read_file", async (span) => {
    span.setAttribute("tool.name", "dev_read_file");
    try {
      const response = await adapter.rest.repos.getContent({
        owner,
        repo,
        path,
        ...(ref != null ? { ref } : {}),
      });

      const rawData = response.data;

      // Narrow to file type
      if (!("content" in rawData) || rawData.type !== "file") {
        throw new NotFoundError({ resource: "file" });
      }

      // Decode base64 content (strip embedded newlines first — same as readIssue)
      const decoded = Buffer.from(
        rawData.content.replace(/\n/g, ""),
        "base64",
      ).toString("utf8");

      // Line slicing
      let content = decoded;
      let truncated = false;
      if (startLine != null || endLine != null) {
        const lines = decoded.split("\n");
        const start = (startLine ?? 1) - 1; // convert to 0-indexed
        const end = endLine ?? lines.length; // inclusive endLine → exclusive slice
        content = lines.slice(start, end).join("\n");
        truncated = start > 0 || end < lines.length;
      }

      span.setStatus({ code: SpanStatusCode.OK });
      const parsed = DevReadFileOutputSchema.safeParse({
        content,
        path: rawData.path,
        truncated,
      });
      if (!parsed.success) {
        throw new SchemaValidationError({
          field: "devReadFileOutput",
          issues: parsed.error.issues.map((issue) => issue.message),
        });
      }
      return parsed.data;
    } catch (err) {
      // Record the original exception on the span once, regardless of type.
      const error = err instanceof Error ? err : new Error(String(err));
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });

      // Re-throw errors that are already typed (e.g. NotFoundError from the
      // file-vs-directory narrowing, SchemaValidationError from the path
      // traversal guard would be thrown before the span opens but we keep
      // the check defensively).
      if (
        err instanceof NotFoundError ||
        err instanceof AuthError ||
        err instanceof GitHubApiError ||
        err instanceof SchemaValidationError
      ) {
        throw err;
      }

      // Error mapping mirrors readIssue in github.ts: 404 → NotFoundError,
      // 401/403 → AuthError, otherwise GitHubApiError.
      const e = err as { status?: number; message?: string };
      const status = e.status ?? 500;
      if (status === 404) {
        throw new NotFoundError({ resource: "file" });
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
