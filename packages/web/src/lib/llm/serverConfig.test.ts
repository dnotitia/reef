// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ServerLlmConfigError,
  getRequiredServerLlmConfig,
  resolveServerLlmConfig,
} from "./serverConfig";

describe("server OpenRouter LLM config", () => {
  const completeEnv = {
    NODE_ENV: "test",
    OPENROUTER_API_KEY: "sk-test",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    REEF_LLM_MODEL: "deepseek/deepseek-v4-flash",
  } satisfies NodeJS.ProcessEnv;

  it("resolves complete env into an LLM config and public status", () => {
    const result = resolveServerLlmConfig(completeEnv);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.config).toEqual({
      api_key: "sk-test",
      base_url: "https://openrouter.ai/api/v1",
      model: "deepseek/deepseek-v4-flash",
    });
    expect(result.status).toEqual({
      isConfigured: true,
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
    });
  });

  it("returns unconfigured status when a required env value is missing", () => {
    const result = resolveServerLlmConfig({
      ...completeEnv,
      OPENROUTER_API_KEY: "",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toEqual({
      isConfigured: false,
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
    });
  });

  it("rejects invalid base URLs", () => {
    const result = resolveServerLlmConfig({
      ...completeEnv,
      OPENROUTER_BASE_URL: "not-a-url",
    });

    expect(result.ok).toBe(false);
  });

  it("throws ServerLlmConfigError when required config is invalid", () => {
    expect(() =>
      getRequiredServerLlmConfig({
        ...completeEnv,
        REEF_LLM_MODEL: "",
      }),
    ).toThrow(ServerLlmConfigError);
  });
});
