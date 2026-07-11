// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmError } from "../errors";
import { createLlmAdapter } from "./llm";

function responsesApiResponse(): Response {
  return Response.json({
    id: "resp-test",
    created_at: 1,
    model: "test-model",
    output: [
      {
        type: "message",
        role: "assistant",
        id: "msg-test",
        content: [{ type: "output_text", text: "ok", annotations: [] }],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

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

describe("managed LLM wire contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a UUID Idempotency-Key on the actual AI SDK request", async () => {
    const requestIds: Array<string | null> = [];
    const requestUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrls.push(
          input instanceof Request ? input.url : input.toString(),
        );
        requestIds.push(new Headers(init?.headers).get("Idempotency-Key"));
        return chatCompletionsResponse();
      }),
    );
    const adapter = createLlmAdapter({
      apiKey: "component-key",
      baseUrl: "https://gateway.example.test/v1",
      model: "test-model",
      governanceMode: "platform_hard",
    });

    await adapter.generateText({ model: adapter.model(), prompt: "hello" });

    expect(requestIds).toHaveLength(1);
    expect(requestUrls[0]).toBe(
      "https://gateway.example.test/v1/chat/completions",
    );
    expect(requestIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("does not retry a failed hard-governed wire request", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { message: "gateway unavailable" } },
        { status: 500 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createLlmAdapter({
      apiKey: "component-key",
      baseUrl: "https://gateway.example.test/v1",
      model: "test-model",
      governanceMode: "platform_hard",
    });

    await expect(
      adapter.generateText({ model: adapter.model(), prompt: "hello" }),
    ).rejects.toBeInstanceOf(LlmError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not add a managed request identity in external-metering mode", async () => {
    let requestId: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestId = new Headers(init?.headers).get("Idempotency-Key");
        return responsesApiResponse();
      }),
    );
    const adapter = createLlmAdapter({
      apiKey: "provider-key",
      baseUrl: "https://provider.example.test/v1",
      model: "test-model",
    });

    await adapter.generateText({ model: adapter.model(), prompt: "hello" });

    expect(requestId).toBeNull();
  });
});
