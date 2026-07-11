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
      governance_mode: "external_metering",
      platform_gateway_base_url: null,
    });
    expect(result.status).toEqual({
      isConfigured: true,
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
    });
  });

  it("requires dedicated credentials and an exact trust anchor for platform_hard", () => {
    const gateway = "http://akb-platform-api-gateway.akb-platform.svc:4000/v1";
    const result = resolveServerLlmConfig({
      NODE_ENV: "production",
      REEF_LLM_API_KEY: "gateway-key",
      REEF_LLM_BASE_URL: `${gateway}/`,
      REEF_LLM_MODEL: "deepseek/deepseek-v4-flash",
      REEF_LLM_GOVERNANCE_MODE: "platform_hard",
      REEF_PLATFORM_GATEWAY_BASE_URL: gateway,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.config).toEqual({
      api_key: "gateway-key",
      base_url: gateway,
      model: "deepseek/deepseek-v4-flash",
      governance_mode: "platform_hard",
      platform_gateway_base_url: gateway,
    });
    expect(result.status.provider).toBe("platform-gateway");
  });

  it("rejects hard mode with legacy provider credentials, URL drift, or an unknown mode", () => {
    const gateway = "https://gateway.example.test/v1";
    const managed = {
      NODE_ENV: "production",
      REEF_LLM_API_KEY: "gateway-key",
      REEF_LLM_BASE_URL: gateway,
      REEF_LLM_MODEL: "model-a",
      REEF_LLM_GOVERNANCE_MODE: "platform_hard",
      REEF_PLATFORM_GATEWAY_BASE_URL: gateway,
    } satisfies NodeJS.ProcessEnv;

    expect(
      resolveServerLlmConfig({ ...managed, OPENROUTER_API_KEY: "direct-key" })
        .ok,
    ).toBe(false);
    expect(
      resolveServerLlmConfig({
        ...managed,
        REEF_LLM_BASE_URL: "https://openrouter.ai/api/v1",
      }).ok,
    ).toBe(false);
    expect(
      resolveServerLlmConfig({
        ...managed,
        REEF_LLM_GOVERNANCE_MODE: "typo-falls-open",
      }).ok,
    ).toBe(false);
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
