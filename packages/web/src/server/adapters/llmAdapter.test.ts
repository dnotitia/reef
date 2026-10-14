import { LlmError } from "@reef/core";
import { type CoreLogger, setCoreLogger } from "@reef/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmAdapter } from "./llmAdapter";

// ─── AI SDK Mocks ─────────────────────────────────────────────────────────────
// vi.mock is hoisted to the top of the module by Vitest. Use vi.hoisted() to
// declare mock function refs that can be referenced both in vi.mock factories
// and in test bodies.

const {
  mockGenerateText,
  mockStreamText,
  mockOpenAiProvider,
  mockWrapLanguageModel,
} = vi.hoisted(() => {
  const mockModelInstance = { type: "stub-language-model" };
  const mockOpenAiProvider = Object.assign(
    vi.fn(() => mockModelInstance),
    {
      chat: vi.fn(() => mockModelInstance),
    },
  );
  const mockGenerateText = vi.fn();
  const mockStreamText = vi.fn();
  const mockWrapLanguageModel = vi.fn(({ model }) => ({
    type: "identified-language-model",
    wrapped: model,
  }));
  return {
    mockGenerateText,
    mockStreamText,
    mockOpenAiProvider,
    mockWrapLanguageModel,
  };
});

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  streamText: mockStreamText,
  wrapLanguageModel: mockWrapLanguageModel,
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
    expect(adapter).toHaveProperty("maxRetries");
    expect(typeof adapter.model).toBe("function");
    expect(typeof adapter.streamText).toBe("function");
    expect(typeof adapter.generateText).toBe("function");
  });

  describe("adapter.generateText", () => {
    it("merges telemetry into the AI SDK call without recording inputs or outputs", async () => {
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
        telemetry: {
          isEnabled: boolean;
          functionId: string;
          recordInputs: boolean;
          recordOutputs: boolean;
        };
      };
      expect(callArgs.telemetry).toMatchObject({
        isEnabled: true,
        functionId: "reef.generateText",
        recordInputs: false,
        recordOutputs: false,
      });
    });

    describe("token usage + finish reason capture (REEF-271)", () => {
      afterEach(() => {
        setCoreLogger(null);
      });

      function captureObserve() {
        const calls: Array<{
          fields: Record<string, unknown>;
          msg: string;
        }> = [];
        const record = () => (fields: Record<string, unknown>, msg: string) => {
          calls.push({ fields, msg });
        };
        const logger: CoreLogger = {
          info: record(),
          warn: record(),
          debug: record(),
        };
        setCoreLogger(logger);
        return calls;
      }

      it("records result usage and finish reason in the backend measurement", async () => {
        mockGenerateText.mockResolvedValueOnce({
          text: "ok",
          usage: { inputTokens: 11, outputTokens: 22 },
          finishReason: "stop",
        });
        const calls = captureObserve();

        const adapter = createLlmAdapter(makeParams());
        await adapter.generateText({ model: adapter.model(), prompt: "hi" });

        const line = calls.find((c) => c.msg === "llm.generateText");
        expect(line).toBeDefined();
        expect(line?.fields).toMatchObject({
          "llm.model": "gpt-4o",
          "llm.usage.prompt_tokens": 11,
          "llm.usage.completion_tokens": 22,
          "llm.finish_reason": "stop",
        });
      });

      it("omits absent token counts but still records model + finish reason", async () => {
        mockGenerateText.mockResolvedValueOnce({
          text: "ok",
          finishReason: "stop",
        });
        const calls = captureObserve();

        const adapter = createLlmAdapter(makeParams());
        await adapter.generateText({ model: adapter.model(), prompt: "hi" });

        const line = calls.find((c) => c.msg === "llm.generateText");
        expect(line?.fields).toMatchObject({
          "llm.model": "gpt-4o",
          "llm.finish_reason": "stop",
        });
        expect(line?.fields).not.toHaveProperty("llm.usage.prompt_tokens");
        expect(line?.fields).not.toHaveProperty("llm.usage.completion_tokens");
      });
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

    it("passes an explicit maxRetries=0 policy to streams", () => {
      mockStreamText.mockReturnValueOnce({ toDataStreamResponse: vi.fn() });
      const adapter = createLlmAdapter(makeParams());

      adapter.streamText({
        model: adapter.model(),
        messages: [{ role: "user", content: "hi" }],
      });

      expect(mockStreamText.mock.calls[0]?.[0]).toMatchObject({
        maxRetries: 0,
      });
    });

    it("merges telemetry into the AI SDK streamText call without recording inputs or outputs", () => {
      mockStreamText.mockReturnValueOnce({ toDataStreamResponse: vi.fn() });

      const adapter = createLlmAdapter(makeParams());
      adapter.streamText({
        model: adapter.model(),
        messages: [{ role: "user", content: "hi" }],
      });

      const callArgs = mockStreamText.mock.calls[0][0] as {
        telemetry: {
          isEnabled: boolean;
          functionId: string;
          recordInputs: boolean;
          recordOutputs: boolean;
        };
      };
      expect(callArgs.telemetry).toMatchObject({
        isEnabled: true,
        functionId: "reef.streamText",
        recordInputs: false,
        recordOutputs: false,
      });
    });

    it("uses v7 end and abort callbacks while preserving caller callbacks", () => {
      mockStreamText.mockReturnValueOnce({ toDataStreamResponse: vi.fn() });
      const onEnd = vi.fn();
      const onAbort = vi.fn();
      const onError = vi.fn();
      const adapter = createLlmAdapter(makeParams());

      adapter.streamText({
        model: adapter.model(),
        messages: [{ role: "user", content: "hi" }],
        onEnd,
        onAbort,
        onError,
      });

      const callArgs = mockStreamText.mock.calls.at(-1)?.[0] as {
        onEnd: (event: unknown) => void;
        onAbort: (event: unknown) => void;
        onError: (event: unknown) => void;
      };
      callArgs.onEnd({
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 4 },
      });
      callArgs.onAbort({ steps: [] });
      callArgs.onError({ error: new Error("late stream error") });

      expect(onEnd).toHaveBeenCalledOnce();
      expect(onAbort).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledOnce();
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
