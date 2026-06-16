import { describe, expect, it, vi } from "vitest";
import { LlmError } from "../errors";
import { createLlmAdapter } from "./llm";

// ─── AI SDK Mocks ─────────────────────────────────────────────────────────────
// vi.mock is hoisted to the top of the module by Vitest. Use vi.hoisted() to
// declare mock function refs that can be referenced both in vi.mock factories
// and in test bodies.

const {
  mockGenerateText,
  mockStreamText,
  mockModelInstance,
  mockOpenAiProvider,
} = vi.hoisted(() => {
  const mockModelInstance = { type: "stub-language-model" };
  const mockOpenAiProvider = vi.fn(() => mockModelInstance);
  const mockGenerateText = vi.fn();
  const mockStreamText = vi.fn();
  return {
    mockGenerateText,
    mockStreamText,
    mockModelInstance,
    mockOpenAiProvider,
  };
});

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  streamText: mockStreamText,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => mockOpenAiProvider),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeParams() {
  return {
    apiKey: "test-api-key",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createLlmAdapter", () => {
  it("returns an object with model, streamText, and generateText properties", () => {
    const adapter = createLlmAdapter(makeParams());
    expect(adapter).toHaveProperty("model");
    expect(adapter).toHaveProperty("streamText");
    expect(adapter).toHaveProperty("generateText");
    expect(typeof adapter.model).toBe("function");
    expect(typeof adapter.streamText).toBe("function");
    expect(typeof adapter.generateText).toBe("function");
  });

  it("adapter.model() returns the stub model object", () => {
    const adapter = createLlmAdapter(makeParams());
    const model = adapter.model();
    expect(model).toBe(mockModelInstance);
  });

  it("adapter.model() calls createOpenAI fresh per invocation", async () => {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const mockedCreateOpenAI = vi.mocked(createOpenAI);
    mockedCreateOpenAI.mockClear();
    const adapter = createLlmAdapter(makeParams());
    adapter.model();
    adapter.model();
    // createOpenAI should be called each time model() is invoked
    expect(mockedCreateOpenAI).toHaveBeenCalledTimes(2);
  });

  describe("adapter.generateText", () => {
    it("calls through to the AI SDK generateText function", async () => {
      const fakeResult = {
        text: "hello world",
        usage: { promptTokens: 10, completionTokens: 20 },
        finishReason: "stop",
      };
      mockGenerateText.mockResolvedValueOnce(fakeResult);

      const adapter = createLlmAdapter(makeParams());
      const result = await adapter.generateText({
        model: adapter.model(),
        prompt: "say hello",
      });

      expect(mockGenerateText).toHaveBeenCalledOnce();
      expect(result).toEqual(fakeResult);
    });

    it("merges experimental_telemetry into the AI SDK call", async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: "ok",
        finishReason: "stop",
      });

      const adapter = createLlmAdapter(makeParams());
      await adapter.generateText({
        model: adapter.model(),
        prompt: "test",
      });

      const callArgs = mockGenerateText.mock.calls[0][0] as {
        experimental_telemetry: { isEnabled: boolean; functionId: string };
      };
      expect(callArgs.experimental_telemetry).toMatchObject({
        isEnabled: true,
        functionId: "reef.generateText",
      });
    });

    it("wraps provider errors in LlmError", async () => {
      mockGenerateText.mockRejectedValueOnce(new Error("provider down"));

      const adapter = createLlmAdapter(makeParams());
      await expect(
        adapter.generateText({ model: adapter.model(), prompt: "fail me" }),
      ).rejects.toBeInstanceOf(LlmError);
    });

    it("LlmError preserves the original error message in context", async () => {
      mockGenerateText.mockRejectedValueOnce(new Error("rate limited"));

      const adapter = createLlmAdapter(makeParams());
      try {
        await adapter.generateText({ model: adapter.model(), prompt: "test" });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(LlmError);
        // The detail is now flattened via extractErrorDetail so the original
        // message is embedded ("err=Error: rate limited"); we just care that
        // the substring survives so callers can still diagnose.
        expect((err as LlmError).context.message).toMatch(/rate limited/);
      }
    });

    it("LlmError surfaces provider statusCode + responseBody from a RetryError chain", async () => {
      const apiCallError = Object.assign(new Error("Provider returned error"), {
        statusCode: 401,
        url: "https://api.example.com/v1/chat/completions",
        responseBody: '{"error":{"message":"Invalid api key"}}',
      });
      const retryError = Object.assign(
        new Error(
          "Failed after 3 attempts. Last error: Provider returned error",
        ),
        { lastError: apiCallError, errors: [apiCallError] },
      );
      mockGenerateText.mockRejectedValueOnce(retryError);

      const adapter = createLlmAdapter(makeParams());
      try {
        await adapter.generateText({ model: adapter.model(), prompt: "test" });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(LlmError);
        const detail = (err as LlmError).context.message;
        expect(detail).toMatch(/statusCode=401/);
        expect(detail).toMatch(/Invalid api key/);
        expect(detail).toMatch(/api\.example\.com/);
      }
    });
  });

  describe("adapter.streamText", () => {
    it("calls through to the AI SDK streamText function and returns the result", () => {
      const fakeResult = { toDataStreamResponse: vi.fn() };
      mockStreamText.mockReturnValueOnce(fakeResult);

      const adapter = createLlmAdapter(makeParams());
      const result = adapter.streamText({
        model: adapter.model(),
        messages: [{ role: "user", content: "hi" }],
      });

      expect(mockStreamText).toHaveBeenCalledOnce();
      expect(result).toBe(fakeResult);
    });

    it("merges experimental_telemetry into the AI SDK streamText call", () => {
      mockStreamText.mockReturnValueOnce({ toDataStreamResponse: vi.fn() });

      const adapter = createLlmAdapter(makeParams());
      adapter.streamText({
        model: adapter.model(),
        messages: [{ role: "user", content: "hi" }],
      });

      const callArgs = mockStreamText.mock.calls[0][0] as {
        experimental_telemetry: { isEnabled: boolean; functionId: string };
      };
      expect(callArgs.experimental_telemetry).toMatchObject({
        isEnabled: true,
        functionId: "reef.streamText",
      });
    });

    it("wraps synchronous setup errors from streamText in LlmError", () => {
      // streamText returns synchronously; a throw here represents a provider
      // setup failure (e.g., invalid config) — NOT a stream-level error
      // (those flow through the onError callback instead).
      mockStreamText.mockImplementationOnce(() => {
        throw new Error("provider setup failure");
      });

      const adapter = createLlmAdapter(makeParams());
      expect(() =>
        adapter.streamText({
          model: adapter.model(),
          messages: [{ role: "user", content: "hi" }],
        }),
      ).toThrow(LlmError);
    });

    it("streamText LlmError preserves the original error message in context", () => {
      mockStreamText.mockImplementationOnce(() => {
        throw new Error("bad api key");
      });

      const adapter = createLlmAdapter(makeParams());
      try {
        adapter.streamText({
          model: adapter.model(),
          messages: [{ role: "user", content: "hi" }],
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(LlmError);
        expect((err as LlmError).context.message).toMatch(/bad api key/);
      }
    });
  });
});
