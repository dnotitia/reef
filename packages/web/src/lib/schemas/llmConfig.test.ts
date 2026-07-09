// @vitest-environment node

import { describe, expect, it } from "vitest";
import { LLMConfigSchema } from "./llmConfig";

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
