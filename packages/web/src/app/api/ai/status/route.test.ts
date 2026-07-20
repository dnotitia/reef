// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/ai/status", () => {
  beforeEach(() => {
    for (const key of ["OPENROUTER_API_KEY", "OPENROUTER_BASE_URL"]) {
      vi.stubEnv(key, "");
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns configured LLM endpoint status", async () => {
    vi.stubEnv("REEF_LLM_API_KEY", "endpoint-key");
    vi.stubEnv("REEF_LLM_BASE_URL", "https://llm.example.test/v1");
    vi.stubEnv("REEF_LLM_MODEL", "deepseek/deepseek-v4-flash");

    const res = GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      isConfigured: true,
      state: "enabled",
      model: "deepseek/deepseek-v4-flash",
    });
  });

  it("returns unconfigured status without exposing secret values", async () => {
    vi.stubEnv("REEF_LLM_API_KEY", "");
    vi.stubEnv("REEF_LLM_BASE_URL", "");
    vi.stubEnv("REEF_LLM_MODEL", "");

    const res = GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      isConfigured: false,
      state: "disabled",
      model: null,
    });
  });
});
