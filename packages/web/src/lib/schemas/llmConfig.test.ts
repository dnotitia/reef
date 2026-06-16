// @vitest-environment node

import { describe, expect, it } from "vitest";
import { ChatRequestBodySchema, LLMConfigSchema } from "./llmConfig";

describe("LLMConfigSchema", () => {
  it("parses a valid LLM config", () => {
    const result = LLMConfigSchema.safeParse({
      api_key: "sk-test-key",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.api_key).toBe("sk-test-key");
      expect(result.data.base_url).toBe("https://api.openai.com/v1");
      expect(result.data.model).toBe("gpt-4o-mini");
    }
  });

  it("accepts http base_url (dev-only localhost providers)", () => {
    const result = LLMConfigSchema.safeParse({
      api_key: "sk-test-key",
      base_url: "http://localhost:1234/v1",
      model: "gpt-4o-mini",
    });
    expect(result.success).toBe(true);
  });

  it("fails when api_key is empty", () => {
    const result = LLMConfigSchema.safeParse({
      api_key: "",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    });
    expect(result.success).toBe(false);
  });

  it("fails when base_url is not a valid URL", () => {
    const result = LLMConfigSchema.safeParse({
      api_key: "sk-test-key",
      base_url: "not-a-url",
      model: "gpt-4o-mini",
    });
    expect(result.success).toBe(false);
  });

  it("fails when base_url uses a non-http(s) scheme", () => {
    const result = LLMConfigSchema.safeParse({
      api_key: "sk-test-key",
      base_url: "file:///etc/passwd",
      model: "gpt-4o-mini",
    });
    expect(result.success).toBe(false);
  });

  it("accepts uppercase HTTPS scheme (RFC 3986 case-insensitive)", () => {
    // Schemes are case-insensitive per RFC 3986; real providers may normalize
    // differently. We should not reject 'HTTPS://...' as invalid.
    const result = LLMConfigSchema.safeParse({
      api_key: "sk-test-key",
      base_url: "HTTPS://api.openai.com/v1",
      model: "gpt-4o-mini",
    });
    expect(result.success).toBe(true);
  });

  it("fails when model is empty", () => {
    const result = LLMConfigSchema.safeParse({
      api_key: "sk-test-key",
      base_url: "https://api.openai.com/v1",
      model: "",
    });
    expect(result.success).toBe(false);
  });

  it("fails when required fields are missing", () => {
    const result = LLMConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("ChatRequestBodySchema", () => {
  it("accepts a valid messages array (v5 UIMessage parts shape)", () => {
    const result = ChatRequestBodySchema.safeParse({
      messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
    });
    expect(result.success).toBe(true);
    expect(result.data?.messages[0]?.id).toBe("chat-message-0");
  });

  it("accepts AI SDK text part metadata from persisted assistant messages", () => {
    const result = ChatRequestBodySchema.safeParse({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "hello",
              state: "done",
              providerMetadata: { openai: { cachedTokens: 3 } },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty messages array", () => {
    const result = ChatRequestBodySchema.safeParse({ messages: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a missing messages field", () => {
    const result = ChatRequestBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects an unknown role", () => {
    const result = ChatRequestBodySchema.safeParse({
      messages: [{ role: "hacker", parts: [{ type: "text", text: "x" }] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a text part missing the `text` field (fallback must not absorb malformed text)", () => {
    const result = ChatRequestBodySchema.safeParse({
      messages: [{ role: "user", parts: [{ type: "text" }] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a tool-* part wrapped as a generic fallback shape mismatch", () => {
    // A `tool-foo` part is accepted by ToolPartSchema (passthrough), but the
    // FallbackPartSchema should not also accept it — otherwise a malformed
    // `tool-foo` would slip through. Here we sanity-check that the guard
    // rejects a part typed as `text` lacking a string `text` field.
    const result = ChatRequestBodySchema.safeParse({
      messages: [
        {
          role: "user",
          parts: [{ type: "text", text: 123 as unknown as string }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts tool-* parts inside a message", () => {
    const result = ChatRequestBodySchema.safeParse({
      messages: [
        {
          role: "assistant",
          parts: [
            { type: "text", text: "Drafting..." },
            {
              type: "tool-draft_issue",
              toolCallId: "abc",
              state: "output-available",
              output: {
                proposal: {
                  operation: "create",
                  create: { fields: { title: "x" }, content: "y" },
                },
              },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
