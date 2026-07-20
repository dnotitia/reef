// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ServerLlmConfigError,
  createServerLlmAdapter,
  getRequiredServerLlmConfig,
  resolveServerLlmConfig,
} from "./serverConfig";

describe("server LLM config", () => {
  const enabledEnv = {
    NODE_ENV: "test",
    REEF_LLM_API_KEY: "endpoint-key",
    REEF_LLM_BASE_URL: "https://llm.example.test/v1/",
    REEF_LLM_MODEL: "deepseek/deepseek-v4-flash",
  } satisfies NodeJS.ProcessEnv;

  it("loads one provider-neutral LLM endpoint", () => {
    const result = resolveServerLlmConfig(enabledEnv);

    expect(result).toEqual({
      ok: true,
      config: {
        api_key: "endpoint-key",
        base_url: "https://llm.example.test/v1",
        model: "deepseek/deepseek-v4-flash",
      },
      status: {
        isConfigured: true,
        state: "enabled",
        model: "deepseek/deepseek-v4-flash",
      },
    });
  });

  it("treats no LLM variables as a valid disabled capability", () => {
    expect(resolveServerLlmConfig({ NODE_ENV: "production" })).toEqual({
      ok: true,
      config: null,
      status: {
        isConfigured: false,
        state: "disabled",
        model: null,
      },
    });
  });

  it("rejects every partial canonical LLM configuration", () => {
    for (const env of [
      { REEF_LLM_API_KEY: "endpoint-key" },
      { REEF_LLM_BASE_URL: "https://llm.example.test/v1" },
      { REEF_LLM_MODEL: "model-a" },
      {
        REEF_LLM_API_KEY: "endpoint-key",
        REEF_LLM_MODEL: "model-a",
      },
    ]) {
      const result = resolveServerLlmConfig(env);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected invalid config");
      expect(result.issues).toContain(
        "REEF_LLM_API_KEY, REEF_LLM_BASE_URL, and REEF_LLM_MODEL must be set together",
      );
      expect(result.status.state).toBe("invalid");
    }
  });

  it("accepts the main branch OpenRouter variables as compatibility aliases", () => {
    const result = resolveServerLlmConfig({
      OPENROUTER_API_KEY: "legacy-key",
      OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
      REEF_LLM_MODEL: "model-a",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid aliases");
    expect(result.config).toEqual({
      api_key: "legacy-key",
      base_url: "https://openrouter.ai/api/v1",
      model: "model-a",
    });
  });

  it("rejects conflicting canonical and compatibility alias values", () => {
    const result = resolveServerLlmConfig({
      ...enabledEnv,
      OPENROUTER_API_KEY: "different-key",
      OPENROUTER_BASE_URL: "https://different.example/v1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected alias conflict");
    expect(result.issues).toEqual([
      "REEF_LLM_API_KEY and its OPENROUTER_API_KEY alias must not disagree",
      "REEF_LLM_BASE_URL and its OPENROUTER_BASE_URL alias must not disagree",
    ]);
  });

  it("validates the canonical endpoint URL", () => {
    const result = resolveServerLlmConfig({
      ...enabledEnv,
      REEF_LLM_BASE_URL: "ftp://llm.example.test/v1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid config");
    expect(result.issues).toContain("base_url must use http or https");
  });

  it("creates the common request policy without provider knowledge", () => {
    const config = getRequiredServerLlmConfig(enabledEnv);
    const adapter = createServerLlmAdapter(config);

    expect(adapter.maxRetries).toBe(0);
  });

  it("throws when a caller requires a disabled LLM capability", () => {
    expect(() => getRequiredServerLlmConfig({})).toThrow(ServerLlmConfigError);
  });
});
