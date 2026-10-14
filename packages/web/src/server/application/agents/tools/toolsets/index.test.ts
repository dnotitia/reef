import {
  type GitHubAdapter,
  createGitHubAdapter,
} from "@/server/adapters/githubAdapter";
import { SchemaValidationError } from "@reef/core";
import { describe, expect, it, vi } from "vitest";
import { makeTestAkbAdapter } from "../__test-helpers__/fetchMock";
import {
  createIssueAuthoringToolset,
  createRepoReadToolset,
  createWorkspaceReadToolset,
} from "./index";

describe("agent toolsets", () => {
  it("builds workspaceRead with optional assignee discovery", () => {
    const adapter = makeTestAkbAdapter();

    expect(
      Object.keys(
        createWorkspaceReadToolset({
          adapter,
          vault: "reef-test",
          includeAssignees: false,
        }),
      ).sort(),
    ).toEqual(["read_issue", "search_issues"]);

    expect(
      Object.keys(
        createWorkspaceReadToolset({
          adapter,
          vault: "reef-test",
        }),
      ).sort(),
    ).toEqual(["list_assignees", "read_issue", "search_issues"]);
  });

  it("includes search_documents only when opted in (REEF-361)", () => {
    const adapter = makeTestAkbAdapter();

    // Default: no document search — keeps issue-just read-toolset consumers
    // (e.g. the issue-enrichment semantic linker) unchanged.
    expect(
      Object.keys(createWorkspaceReadToolset({ adapter, vault: "reef-test" })),
    ).not.toContain("search_documents");

    expect(
      Object.keys(
        createWorkspaceReadToolset({
          adapter,
          vault: "reef-test",
          includeDocuments: true,
        }),
      ).sort(),
    ).toEqual([
      "list_assignees",
      "read_issue",
      "search_documents",
      "search_issues",
    ]);
  });

  it("builds repoRead as allowlist-scoped unbound or closure-bound to the selected repo", () => {
    const githubAdapter = createGitHubAdapter({ token: "test-token" });

    // Unbound tools require a monitored-repo allowlist (REEF-243).
    expect(
      Object.keys(
        createRepoReadToolset({
          githubAdapter,
          allowedRepos: [{ owner: "acme", repo: "platform" }],
        }),
      ).sort(),
    ).toEqual(["dev_read_file", "search_code"]);

    expect(
      Object.keys(
        createRepoReadToolset({
          githubAdapter,
          repoContext: { owner: "acme", repo: "platform" },
        }),
      ).sort(),
    ).toEqual(["dev_read_file", "search_code"]);
  });

  it("scopes unbound repo tools to the allowlist (rejects others) even when empty", async () => {
    const searchCode = vi.fn().mockResolvedValue([]);
    const readFile = vi
      .fn()
      .mockResolvedValue({ path: "file.txt", content: "" });
    const githubAdapter = { searchCode, readFile } as unknown as GitHubAdapter;
    const toolset = createRepoReadToolset({ githubAdapter, allowedRepos: [] });
    if (!toolset.search_code.execute || !toolset.dev_read_file.execute) {
      throw new Error("repo read tools must be executable");
    }
    const options = { toolCallId: "test", messages: [], context: {} };
    await expect(
      toolset.search_code.execute(
        { query: "x", owner: "any", repo: "repo", maxResults: 10 },
        options,
      ),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      toolset.dev_read_file.execute(
        {
          owner: "any",
          repo: "repo",
          path: "file.txt",
          ref: null,
          startLine: null,
          endLine: null,
        },
        options,
      ),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(searchCode).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("executes repoRead tools against the server-selected repo context", async () => {
    const calls: Array<{
      query: string;
      owner: string;
      repo: string;
      maxResults: number;
    }> = [];
    const githubAdapter = {
      searchCode: async (input: {
        query: string;
        owner: string;
        repo: string;
        maxResults: number;
      }) => {
        calls.push(input);
        return [
          {
            path: "src/server.ts",
            line: 1,
            snippet: "const server = true;",
          },
        ];
      },
    } as unknown as GitHubAdapter;

    const toolset = createRepoReadToolset({
      githubAdapter,
      repoContext: { owner: "safe-owner", repo: "safe-repo" },
    });

    const searchCodeTool = toolset.search_code as unknown as {
      execute?: (
        input: { query: string; maxResults: number },
        options: never,
      ) => Promise<{
        results: Array<{ path: string; line: number; snippet: string }>;
      }>;
    };
    if (!searchCodeTool.execute) throw new Error("search_code has no execute");

    const result = await searchCodeTool.execute(
      {
        query: "repo:evil-owner/secret-repo const server",
        maxResults: 3,
      },
      {
        toolCallId: "test",
        messages: [],
      } as never,
    );

    expect(result).toEqual({
      results: [
        {
          path: "src/server.ts",
          line: 1,
          snippet: "const server = true;",
        },
      ],
    });
    expect(calls[0]).toMatchObject({
      query: "const server",
      owner: "safe-owner",
      repo: "safe-repo",
      maxResults: 3,
    });
  });

  it("builds the issueAuthoring catalog with optional assignee discovery", () => {
    const adapter = makeTestAkbAdapter();

    expect(
      Object.keys(
        createIssueAuthoringToolset({ adapter, vault: "reef-test" }),
      ).sort(),
    ).toEqual([
      "read_issue",
      "read_template",
      "search_documents",
      "search_issues",
    ]);

    expect(
      Object.keys(
        createIssueAuthoringToolset({
          adapter,
          vault: "reef-test",
          includeAssignees: true,
        }),
      ).sort(),
    ).toEqual([
      "list_assignees",
      "read_issue",
      "read_template",
      "search_documents",
      "search_issues",
    ]);
  });
});
