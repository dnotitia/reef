// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/ai/status", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns configured OpenRouter status", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    vi.stubEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1");
    vi.stubEnv("REEF_LLM_MODEL", "deepseek/deepseek-v4-flash");

    const res = GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      isConfigured: true,
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
    });
  });

  it("returns unconfigured status without exposing secret values", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1");
    vi.stubEnv("REEF_LLM_MODEL", "deepseek/deepseek-v4-flash");

    const res = GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      isConfigured: false,
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
    });
  });
});
