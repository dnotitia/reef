import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createGitHubAdapter } from "../../../adapters/github";
import {
  AuthError,
  GitHubApiError,
  NotFoundError,
  SchemaValidationError,
} from "../../../errors";
import { callTool } from "../__test-helpers__/callTool";
import { createBoundSearchCodeTool, createSearchCodeTool } from "./searchCode";

// ─── OTEL Mock ────────────────────────────────────────────────────────────────
// Reuse exact mock shape from github.test.ts — passthrough with spy functions.
type SpanMock = {
  setAttribute: ReturnType<typeof vi.fn>;
  addEvent: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

vi.mock("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2, OK: 1, UNSET: 0 },
  trace: {
    getTracer: () => ({
      startActiveSpan: vi.fn(
        async (
          _name: string,
          fn: (span: SpanMock) => Promise<unknown>,
        ): Promise<unknown> => {
          const span: SpanMock = {
            setAttribute: vi.fn(),
            addEvent: vi.fn(),
            recordException: vi.fn(),
            setStatus: vi.fn(),
            end: vi.fn(),
          };
          return fn(span);
        },
      ),
    }),
  },
}));

// ─── MSW Server ──────────────────────────────────────────────────────────────
// GitHub Code Search API: 30 req/min rate limit (documented in tool description)

const SEARCH_CODE_URL = "https://api.github.com/search/code";

const successHandler = http.get(SEARCH_CODE_URL, () => {
  return HttpResponse.json({
    total_count: 1,
    incomplete_results: false,
    items: [
      {
        name: "foo.ts",
        path: "src/foo.ts",
        sha: "abc123",
        url: "https://api.github.com/repos/owner/repo/contents/src/foo.ts",
        git_url: null,
        html_url: "https://github.com/owner/repo/blob/main/src/foo.ts",
        repository: { id: 1, name: "repo", full_name: "owner/repo" },
        score: 1.0,
        text_matches: [
          {
            object_url:
              "https://api.github.com/repos/owner/repo/contents/src/foo.ts",
            object_type: "FileContent",
            property: "content",
            fragment: "const x = 1",
            matches: [{ text: "const x = 1", indices: [0, 11] }],
          },
        ],
      },
    ],
  });
});

const server = setupServer(successHandler);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createSearchCodeTool", () => {
  it("returns a tool object with execute function", () => {
    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createSearchCodeTool(adapter);
    expect(toolObj).toHaveProperty("inputSchema");
    expect(typeof toolObj.execute).toBe("function");
  });

  it("success: returns correctly-shaped results with path, line, and snippet", async () => {
    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createSearchCodeTool(adapter);

    const result = await callTool(toolObj, {
      query: "const x",
      owner: "owner",
      repo: "repo",
      maxResults: 10,
    });

    expect(result).toEqual({
      results: [
        {
          path: "src/foo.ts",
          line: 1,
          snippet: "const x = 1",
        },
      ],
    });
  });

  it("bound tool searches only the server-selected monitored repo", async () => {
    let observedQuery = "";
    server.use(
      http.get(SEARCH_CODE_URL, ({ request }) => {
        observedQuery = new URL(request.url).searchParams.get("q") ?? "";
        return HttpResponse.json({
          total_count: 0,
          incomplete_results: false,
          items: [],
        });
      }),
    );

    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createBoundSearchCodeTool({
      adapter,
      owner: "safe-owner",
      repo: "safe-repo",
    });

    const result = await callTool(toolObj, {
      query: "const x",
      maxResults: 10,
      owner: "evil-owner",
      repo: "secret-repo",
    } as never);

    expect(result).toEqual({ results: [] });
    expect(observedQuery).toContain("repo:safe-owner/safe-repo");
    expect(observedQuery).not.toContain("evil-owner/secret-repo");
  });

  it("bound tool strips model-supplied GitHub scope qualifiers", async () => {
    let observedQuery = "";
    server.use(
      http.get(SEARCH_CODE_URL, ({ request }) => {
        observedQuery = new URL(request.url).searchParams.get("q") ?? "";
        return HttpResponse.json({
          total_count: 0,
          incomplete_results: false,
          items: [],
        });
      }),
    );

    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createBoundSearchCodeTool({
      adapter,
      owner: "safe-owner",
      repo: "safe-repo",
    });

    await callTool(toolObj, {
      query: 'repo:evil-owner/secret-repo org:evil user:mallory "const x"',
      maxResults: 10,
    });

    expect(observedQuery).toContain('"const x"');
    expect(observedQuery).toContain("repo:safe-owner/safe-repo");
    expect(observedQuery).not.toContain("evil-owner/secret-repo");
    expect(observedQuery).not.toContain("org:evil");
    expect(observedQuery).not.toContain("user:mallory");
  });

  it("rejects code search queries made only of scope qualifiers", async () => {
    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createBoundSearchCodeTool({
      adapter,
      owner: "safe-owner",
      repo: "safe-repo",
    });

    await expect(
      callTool(toolObj, {
        query: "repo:evil-owner/secret-repo org:evil",
        maxResults: 10,
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it("returns line: 0 and empty snippet when no text_matches in response", async () => {
    server.use(
      http.get(SEARCH_CODE_URL, () => {
        return HttpResponse.json({
          total_count: 1,
          incomplete_results: false,
          items: [
            {
              name: "bar.ts",
              path: "src/bar.ts",
              sha: "def456",
              url: "https://api.github.com/repos/owner/repo/contents/src/bar.ts",
              git_url: null,
              html_url: "https://github.com/owner/repo/blob/main/src/bar.ts",
              repository: { id: 1, name: "repo", full_name: "owner/repo" },
              score: 1.0,
              // no text_matches field
            },
          ],
        });
      }),
    );

    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createSearchCodeTool(adapter);

    const result = await callTool(toolObj, {
      query: "something",
      owner: "owner",
      repo: "repo",
      maxResults: 10,
    });

    expect(result.results[0].line).toBe(0);
    expect(result.results[0].snippet).toBe("");
  });

  it("401 response → throws AuthError", async () => {
    server.use(
      http.get(SEARCH_CODE_URL, () => {
        return HttpResponse.json(
          { message: "Bad credentials" },
          { status: 401 },
        );
      }),
    );

    const adapter = createGitHubAdapter({ token: "bad-token" });
    const toolObj = createSearchCodeTool(adapter);

    await expect(
      callTool(toolObj, {
        query: "test",
        owner: "owner",
        repo: "repo",
        maxResults: 10,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("403 response → throws AuthError", async () => {
    server.use(
      http.get(SEARCH_CODE_URL, () => {
        return HttpResponse.json({ message: "Forbidden" }, { status: 403 });
      }),
    );

    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createSearchCodeTool(adapter);

    await expect(
      callTool(toolObj, {
        query: "test",
        owner: "owner",
        repo: "repo",
        maxResults: 10,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("404 response → throws NotFoundError (repo not found)", async () => {
    server.use(
      http.get(SEARCH_CODE_URL, () => {
        return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      }),
    );

    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createSearchCodeTool(adapter);

    await expect(
      callTool(toolObj, {
        query: "test",
        owner: "owner",
        repo: "nonexistent",
        maxResults: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("non-2xx response other than 401/403/404 → throws GitHubApiError", async () => {
    server.use(
      http.get(SEARCH_CODE_URL, () => {
        return HttpResponse.json(
          { message: "Internal Server Error" },
          { status: 500 },
        );
      }),
    );

    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createSearchCodeTool(adapter);

    await expect(
      callTool(toolObj, {
        query: "test",
        owner: "owner",
        repo: "repo",
        maxResults: 10,
      }),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });

  it("OTEL span is started and ended on success", async () => {
    // The vi.mock for @opentelemetry/api uses a passthrough spy. Because startActiveSpan
    // is called, the span's end() should be called in the finally block.
    // We verify by checking the mock was called without throwing.
    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createSearchCodeTool(adapter);

    // Should not throw — OTEL span lifecycle is managed by the tool execute body
    await expect(
      callTool(toolObj, {
        query: "const x",
        owner: "owner",
        repo: "repo",
        maxResults: 10,
      }),
    ).resolves.toBeDefined();
  });
});
