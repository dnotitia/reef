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
import {
  createBoundDevReadFileTool,
  createDevReadFileTool,
} from "./devReadFile";

// Monitored-repo allowlist the unbound tool is scoped to; out-of-allowlist
// access is asserted separately.
const ALLOWED_REPOS = [{ owner: "owner", repo: "repo" }];

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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FILE_CONTENT = "line1\nline2\nline3\nline4";
const ENCODED_CONTENT = Buffer.from(FILE_CONTENT, "utf8").toString("base64");

function makeFileResponse(content = ENCODED_CONTENT, path = "src/main.ts") {
  return {
    type: "file" as const,
    encoding: "base64" as const,
    size: content.length,
    name: "main.ts",
    path,
    content,
    sha: "abc123",
    url: `https://api.github.com/repos/owner/repo/contents/${path}`,
    html_url: `https://github.com/owner/repo/blob/main/${path}`,
    git_url: null,
    download_url: null,
    _links: {
      self: `https://api.github.com/repos/owner/repo/contents/${path}`,
      git: null,
      html: `https://github.com/owner/repo/blob/main/${path}`,
    },
  };
}

// ─── MSW Server ──────────────────────────────────────────────────────────────
// NOTE: Octokit URL-encodes path segments (e.g. "src/main.ts" → "src%2Fmain.ts"),
// so we use a wildcard pattern to match all contents API calls for our test repo.

const CONTENTS_URL_PATTERN =
  "https://api.github.com/repos/owner/repo/contents/:path";

const server = setupServer(
  http.get(CONTENTS_URL_PATTERN, () => {
    return HttpResponse.json(makeFileResponse());
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createDevReadFileTool", () => {
  it("returns a tool object with execute function", () => {
    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createDevReadFileTool(adapter, ALLOWED_REPOS);
    expect(toolObj).toHaveProperty("inputSchema");
    expect(typeof toolObj.execute).toBe("function");
  });

  it("success: returns full content, path, and truncated: false", async () => {
    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createDevReadFileTool(adapter, ALLOWED_REPOS);

    const result = await callTool(toolObj, {
      owner: "owner",
      repo: "repo",
      path: "src/main.ts",
      ref: null,
      startLine: null,
      endLine: null,
    });

    expect(result.content).toBe(FILE_CONTENT);
    expect(result.path).toBe("src/main.ts");
    expect(result.truncated).toBe(false);
  });

  it("rejects a repo outside the monitored-repo allowlist without calling GitHub", async () => {
    // MSW errors on unhandled requests, so a leaked GitHub call would fail the
    // test; the allowlist guard must reject before any network read.
    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createDevReadFileTool(adapter, ALLOWED_REPOS);

    await expect(
      callTool(toolObj, {
        owner: "other-owner",
        repo: "private-repo",
        path: "src/main.ts",
        ref: null,
        startLine: null,
        endLine: null,
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it("bound tool reads only from the server-selected monitored repo", async () => {
    let observedUrl = "";
    server.use(
      http.get(
        "https://api.github.com/repos/safe-owner/safe-repo/contents/:path",
        ({ request }) => {
          observedUrl = request.url;
          return HttpResponse.json(makeFileResponse());
        },
      ),
      http.get(
        "https://api.github.com/repos/evil-owner/secret-repo/contents/:path",
        () => {
          return HttpResponse.json(
            { message: "Wrong repository" },
            { status: 500 },
          );
        },
      ),
    );

    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createBoundDevReadFileTool({
      adapter,
      owner: "safe-owner",
      repo: "safe-repo",
    });

    const result = await callTool(toolObj, {
      path: "src/main.ts",
      ref: null,
      startLine: null,
      endLine: null,
      owner: "evil-owner",
      repo: "secret-repo",
    } as never);

    expect(result.content).toBe(FILE_CONTENT);
    expect(observedUrl).toContain("/repos/safe-owner/safe-repo/contents/");
    expect(observedUrl).not.toContain("/repos/evil-owner/secret-repo/");
  });

  it("line range: startLine=2, endLine=3 → returns lines 2–3 and truncated: true", async () => {
    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createDevReadFileTool(adapter, ALLOWED_REPOS);

    const result = await callTool(toolObj, {
      owner: "owner",
      repo: "repo",
      path: "src/main.ts",
      startLine: 2,
      endLine: 3,
      ref: null,
    });

    expect(result.content).toBe("line2\nline3");
    expect(result.truncated).toBe(true);
  });

  it("path traversal '../etc/passwd' → throws SchemaValidationError before any network call", async () => {
    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createDevReadFileTool(adapter, ALLOWED_REPOS);

    // Guard throws before any network call — no MSW intercept needed.
    // onUnhandledRequest: "error" would catch any accidental network call.
    await expect(
      callTool(toolObj, {
        owner: "owner",
        repo: "repo",
        path: "../etc/passwd",
        ref: null,
        startLine: null,
        endLine: null,
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it("directory response (array) → throws NotFoundError", async () => {
    server.use(
      http.get(CONTENTS_URL_PATTERN, () => {
        // GitHub returns an array for directories
        return HttpResponse.json([makeFileResponse()]);
      }),
    );

    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createDevReadFileTool(adapter, ALLOWED_REPOS);

    await expect(
      callTool(toolObj, {
        owner: "owner",
        repo: "repo",
        path: "src/main.ts",
        ref: null,
        startLine: null,
        endLine: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("404 response → throws NotFoundError", async () => {
    server.use(
      http.get(CONTENTS_URL_PATTERN, () => {
        return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      }),
    );

    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createDevReadFileTool(adapter, ALLOWED_REPOS);

    await expect(
      callTool(toolObj, {
        owner: "owner",
        repo: "repo",
        path: "src/main.ts",
        ref: null,
        startLine: null,
        endLine: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("401 response → throws AuthError", async () => {
    server.use(
      http.get(CONTENTS_URL_PATTERN, () => {
        return HttpResponse.json(
          { message: "Bad credentials" },
          { status: 401 },
        );
      }),
    );

    const adapter = createGitHubAdapter({ token: "bad-token" });
    const toolObj = createDevReadFileTool(adapter, ALLOWED_REPOS);

    await expect(
      callTool(toolObj, {
        owner: "owner",
        repo: "repo",
        path: "src/main.ts",
        ref: null,
        startLine: null,
        endLine: null,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("500 response → throws GitHubApiError", async () => {
    server.use(
      http.get(CONTENTS_URL_PATTERN, () => {
        return HttpResponse.json(
          { message: "Internal Server Error" },
          { status: 500 },
        );
      }),
    );

    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createDevReadFileTool(adapter, ALLOWED_REPOS);

    await expect(
      callTool(toolObj, {
        owner: "owner",
        repo: "repo",
        path: "src/main.ts",
        ref: null,
        startLine: null,
        endLine: null,
      }),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });

  it("only startLine provided → truncated: true", async () => {
    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createDevReadFileTool(adapter, ALLOWED_REPOS);

    const result = await callTool(toolObj, {
      owner: "owner",
      repo: "repo",
      path: "src/main.ts",
      startLine: 3,
      endLine: null,
      ref: null,
    });

    expect(result.content).toBe("line3\nline4");
    expect(result.truncated).toBe(true);
  });

  it("only endLine provided → truncated: true", async () => {
    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createDevReadFileTool(adapter, ALLOWED_REPOS);

    const result = await callTool(toolObj, {
      owner: "owner",
      repo: "repo",
      path: "src/main.ts",
      endLine: 2,
      startLine: null,
      ref: null,
    });

    expect(result.content).toBe("line1\nline2");
    expect(result.truncated).toBe(true);
  });

  it("OTEL span is started and ended on success", async () => {
    const adapter = createGitHubAdapter({ token: "test-token" });
    const toolObj = createDevReadFileTool(adapter, ALLOWED_REPOS);

    await expect(
      callTool(toolObj, {
        owner: "owner",
        repo: "repo",
        path: "src/main.ts",
        ref: null,
        startLine: null,
        endLine: null,
      }),
    ).resolves.toBeDefined();
  });
});
