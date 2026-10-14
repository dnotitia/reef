import { LlmError } from "@reef/core";
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmAdapter } from "./llmAdapter";
import {
  createServerLlmAdapter,
  getRequiredServerLlmConfig,
} from "./llmConfig/serverConfig";

function chatCompletionsResponse(): Response {
  return Response.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

describe("LLM wire contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isolates configured endpoints and credentials while identifying each actual SDK request", async () => {
    const requests: Array<{
      url: string;
      headers: Headers;
      body: { model: string };
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: input instanceof Request ? input.url : input.toString(),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) as { model: string },
        });
        return chatCompletionsResponse();
      }),
    );
    const endpoints = [
      {
        baseUrl: "https://gateway.example.test/v1",
        apiKey: "gateway-key",
        model: "gateway-model",
      },
      {
        baseUrl: "https://provider.example.test/v1",
        apiKey: "provider-key",
        model: "provider-model",
      },
    ];
    const adapters = endpoints.map(({ baseUrl, apiKey, model }) =>
      createServerLlmAdapter(
        getRequiredServerLlmConfig({
          REEF_LLM_API_KEY: apiKey,
          REEF_LLM_BASE_URL: `${baseUrl}/`,
          REEF_LLM_MODEL: model,
        }),
      ),
    );
    for (const [index, adapter] of adapters.entries()) {
      expect(adapter.maxRetries).toBe(0);
      for (const identityHeader of ["idempotency-key", "Idempotency-Key"]) {
        const result = await adapter.generateText({
          model: adapters[0].model(),
          prompt: "hello",
          headers: {
            [identityHeader]: "caller-controlled",
            "X-Reef": "preserved",
          },
        });
        expect(result.text).toBe("ok");
        expect(result.finishReason).toBe("stop");
        expect(result.usage).toMatchObject({
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        });
        const request = requests.at(-1);
        expect(request?.url).toBe(
          `${endpoints[index].baseUrl}/chat/completions`,
        );
        expect(request?.headers.get("Authorization")).toBe(
          `Bearer ${endpoints[index].apiKey}`,
        );
        expect(request?.body.model).toBe(endpoints[index].model);
        expect(request?.headers.get("X-Reef")).toBe("preserved");
        expect(request?.headers.get("Idempotency-Key")).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        );
      }
    }
    expect(requests).toHaveLength(4);
    expect(
      new Set(requests.map(({ headers }) => headers.get("Idempotency-Key")))
        .size,
    ).toBe(4);
  });

  it("does not retry a failed request", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { message: "gateway unavailable" } },
        { status: 500 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createLlmAdapter({
      apiKey: "fixture",
      baseUrl: "https://gateway.example.test/v1",
      model: "test-model",
    });

    await expect(
      adapter.generateText({ model: adapter.model(), prompt: "hello" }),
    ).rejects.toBeInstanceOf(LlmError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
