import { describe, expect, it } from "vitest";
import {
  type GitHubAdapter,
  createGitHubAdapter,
} from "../../../adapters/github";
import { makeTestAkbAdapter } from "../__test-helpers__/fetchMock";
import {
  createIssueAuthoringToolset,
  createRepoReadToolset,
  createSuggestionToolset,
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
    // Safe-by-default: with no repoContext the unbound tools always enforce the
    // allowlist, so an empty allowlist rejects every repo rather than exposing
    // an unbounded GitHub read (REEF-243).
    const githubAdapter = {
      searchCode: async () => {
        throw new Error("unbounded GitHub read must not happen");
      },
    } as unknown as GitHubAdapter;

    const toolset = createRepoReadToolset({ githubAdapter, allowedRepos: [] });
    expect(Object.keys(toolset).sort()).toEqual([
      "dev_read_file",
      "search_code",
    ]);

    const searchCodeTool = toolset.search_code as {
      execute?: (
        input: {
          query: string;
          owner: string;
          repo: string;
          maxResults: number;
        },
        options: never,
      ) => Promise<unknown>;
    };
    if (!searchCodeTool.execute) throw new Error("search_code has no execute");
    await expect(
      searchCodeTool.execute(
        { query: "x", owner: "any", repo: "repo", maxResults: 10 },
        undefined as never,
      ),
    ).rejects.toThrow();
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

    const searchCodeTool = toolset.search_code as {
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

  it("builds issueAuthoring and suggestion toolsets by purpose", () => {
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
          includeSuggestions: true,
        }),
      ).sort(),
    ).toEqual([
      "list_assignees",
      "read_issue",
      "read_template",
      "search_documents",
      "search_issues",
      "suggest_labels",
      "suggest_priority",
    ]);

    expect(Object.keys(createSuggestionToolset()).sort()).toEqual([
      "suggest_labels",
      "suggest_priority",
    ]);
  });
});
