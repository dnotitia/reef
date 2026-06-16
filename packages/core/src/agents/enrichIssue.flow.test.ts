import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AkbAdapter } from "../adapters/akb";
import type { LlmAdapter } from "../adapters/llm";
import { AuthError, LlmError, SchemaValidationError } from "../errors";
import {
  baseRequest,
  enrichIssue,
  mockAdapter,
  mockAdapterSequence,
  mockListIssues,
  mockListPlanningCatalog,
  mockReadConfig,
  resetEnrichIssueMocks,
  stubGithubAdapter,
} from "./enrichIssue.testSupport";

describe("enrichIssue", () => {
  beforeEach(() => {
    resetEnrichIssueMocks();
  });

  it("throws LlmError with finishReason/completion_tokens in detail when text is empty", async () => {
    const adapter = mockAdapter("", {
      finishReason: "length",
      completionTokens: 0,
    });
    try {
      await enrichIssue({
        adapter,
        akbAdapter: { request: vi.fn() } as unknown as AkbAdapter,
        githubAdapter: stubGithubAdapter,
        request: baseRequest,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmError);
      const detail = (err as LlmError).context.message;
      expect(detail).toMatch(/finishReason=length/);
      expect(detail).toMatch(/completion_tokens=0/);
    }
  });

  it("returns the parsed suggestions on a happy path", async () => {
    const adapter = mockAdapter(
      JSON.stringify({
        suggestions: [
          {
            field: "title",
            value: "Better title here",
            reasoning: "More specific.",
            confidence: 0.9,
          },
        ],
      }),
    );

    const result = await enrichIssue({
      adapter,
      akbAdapter: { request: vi.fn() } as unknown as AkbAdapter,
      githubAdapter: stubGithubAdapter,
      request: baseRequest,
    });
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.field).toBe("title");
    const firstCall = vi.mocked(adapter.generateText).mock.calls[0]?.[0] as
      | { output?: { responseFormat?: PromiseLike<unknown> } }
      | undefined;
    await expect(firstCall?.output?.responseFormat).resolves.toMatchObject({
      type: "json",
    });
  });

  it("repairs a prose-only response into valid enrichment JSON", async () => {
    const adapter = mockAdapterSequence([
      "Let me search the workspace first.",
      JSON.stringify({
        suggestions: [
          {
            field: "title",
            value: "Repair password reset expiry handling",
            reasoning: "The repair pass converted the invalid prose response.",
            confidence: 0.8,
          },
        ],
      }),
    ]);

    const result = await enrichIssue({
      adapter,
      akbAdapter: { request: vi.fn() } as unknown as AkbAdapter,
      githubAdapter: stubGithubAdapter,
      request: baseRequest,
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      field: "title",
      value: "Repair password reset expiry handling",
    });
    expect(adapter.generateText).toHaveBeenCalledTimes(2);
    const repairCall = vi.mocked(adapter.generateText).mock.calls[1]?.[0] as
      | { output?: { responseFormat?: PromiseLike<unknown> } }
      | undefined;
    await expect(repairCall?.output?.responseFormat).resolves.toMatchObject({
      type: "json",
    });
  });

  it("repairs prose rescued from provider reasoning fields", async () => {
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 12, totalTokens: 112 },
        response: {
          messages: [{ reasoning_content: "I will analyze the issue first." }],
        },
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              field: "title",
              value: "Clarify login failure during auth flow",
              reasoning: "The repair pass converted rescued reasoning prose.",
              confidence: 0.82,
            },
          ],
        }),
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 120, totalTokens: 220 },
      });
    const adapter = {
      model: vi.fn(),
      streamText: vi.fn(),
      generateText,
    } as unknown as LlmAdapter;

    const result = await enrichIssue({
      adapter,
      akbAdapter: { request: vi.fn() } as unknown as AkbAdapter,
      githubAdapter: stubGithubAdapter,
      request: baseRequest,
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      field: "title",
      value: "Clarify login failure during auth flow",
    });
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("returns empty suggestions when a non-empty repair response is still invalid", async () => {
    const adapter = mockAdapterSequence([
      "Let me search the workspace first.",
      "Still not JSON.",
    ]);

    const result = await enrichIssue({
      adapter,
      akbAdapter: { request: vi.fn() } as unknown as AkbAdapter,
      githubAdapter: stubGithubAdapter,
      request: baseRequest,
    });

    expect(result.suggestions).toEqual([]);
    expect(adapter.generateText).toHaveBeenCalledTimes(2);
  });

  it("drops planning suggestions when planning catalog lookup fails", async () => {
    mockListPlanningCatalog.mockRejectedValueOnce(new Error("planning down"));
    const adapter = mockAdapter(
      JSON.stringify({
        suggestions: [
          {
            field: "sprint_id",
            value: "11111111-1111-4111-8111-111111111111",
            reasoning: "Sprint is named.",
            confidence: 0.9,
          },
        ],
      }),
    );

    const result = await enrichIssue({
      adapter,
      akbAdapter: { request: vi.fn() } as unknown as AkbAdapter,
      githubAdapter: stubGithubAdapter,
      request: baseRequest,
    });

    expect(result.suggestions).toEqual([]);
  });

  it("propagates workspace auth failures before calling the LLM", async () => {
    mockListIssues.mockRejectedValueOnce(
      new AuthError({ message: "workspace token expired" }),
    );
    const adapter = mockAdapter(JSON.stringify({ suggestions: [] }));

    await expect(
      enrichIssue({
        adapter,
        akbAdapter: { request: vi.fn() } as unknown as AkbAdapter,
        githubAdapter: stubGithubAdapter,
        request: baseRequest,
      }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(adapter.generateText).not.toHaveBeenCalled();
  });

  it("rejects repoContext that is not configured as a monitored repo", async () => {
    mockReadConfig.mockResolvedValueOnce({
      exists: true,
      config: {
        project_prefix: "REEF",
        monitored_repos: [{ github_id: 1, owner: "octo", name: "cat" }],
      },
    });
    const adapter = mockAdapter(JSON.stringify({ suggestions: [] }));

    await expect(
      enrichIssue({
        adapter,
        akbAdapter: { request: vi.fn() } as unknown as AkbAdapter,
        githubAdapter: stubGithubAdapter,
        request: {
          ...baseRequest,
          repoContext: { owner: "evil-owner", repo: "secret-repo" },
        },
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(adapter.generateText).not.toHaveBeenCalled();
  });

  it("returns an empty result when the LLM produces no usable suggestions", async () => {
    const adapter = mockAdapter(
      JSON.stringify({ suggestions: [{ field: "priority", value: "bogus" }] }),
    );
    const result = await enrichIssue({
      adapter,
      akbAdapter: { request: vi.fn() } as unknown as AkbAdapter,
      githubAdapter: stubGithubAdapter,
      request: baseRequest,
    });
    expect(result.suggestions).toEqual([]);
  });

  it("wraps non-LlmError failures in LlmError", async () => {
    const adapter = {
      model: vi.fn(),
      streamText: vi.fn(),
      generateText: vi.fn().mockRejectedValue(new Error("network down")),
    } as unknown as LlmAdapter;
    await expect(
      enrichIssue({
        adapter,
        akbAdapter: { request: vi.fn() } as unknown as AkbAdapter,
        githubAdapter: stubGithubAdapter,
        request: baseRequest,
      }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("does not classify optional GitHub tool auth failures as workspace auth", async () => {
    const adapter = {
      model: vi.fn(),
      streamText: vi.fn(),
      generateText: vi.fn().mockRejectedValue(new AuthError({})),
    } as unknown as LlmAdapter;

    await expect(
      enrichIssue({
        adapter,
        akbAdapter: { request: vi.fn() } as unknown as AkbAdapter,
        githubAdapter: stubGithubAdapter,
        request: baseRequest,
      }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("flattens AI SDK RetryError + APICallError chain into the LlmError detail", async () => {
    const apiCallError = Object.assign(new Error("Provider returned error"), {
      statusCode: 401,
      url: "https://api.example.com/v1/chat/completions",
      responseBody: '{"error":{"message":"Invalid api key"}}',
    });
    const retryError = Object.assign(
      new Error("Failed after 3 attempts. Last error: Provider returned error"),
      { lastError: apiCallError, errors: [apiCallError] },
    );

    const adapter = {
      model: vi.fn(),
      streamText: vi.fn(),
      generateText: vi.fn().mockRejectedValue(retryError),
    } as unknown as LlmAdapter;

    try {
      await enrichIssue({
        adapter,
        akbAdapter: { request: vi.fn() } as unknown as AkbAdapter,
        githubAdapter: stubGithubAdapter,
        request: baseRequest,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmError);
      const detail = (err as LlmError).context.message;
      // The flattened detail should surface the underlying provider info
      // somewhere — exact shape (errors[0].* or lastError.*) is implementation
      // detail; the diagnostic substrings should be present.
      expect(detail).toMatch(/statusCode=401/);
      expect(detail).toMatch(/Invalid api key/);
      expect(detail).toMatch(/api\.example\.com/);
    }
  });
});
