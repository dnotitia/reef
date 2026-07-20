// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const LLM_ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "REEF_LLM_MODEL",
  "REEF_LLM_API_KEY",
  "REEF_LLM_BASE_URL",
] as const;

function clearLlmEnv(): void {
  for (const key of LLM_ENV_KEYS) vi.stubEnv(key, "");
}

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/ai/managed-platform", () => {
  it("reports a configured provider-neutral LLM capability", async () => {
    clearLlmEnv();
    vi.stubEnv("REEF_LLM_API_KEY", "endpoint-key");
    vi.stubEnv("REEF_LLM_BASE_URL", "https://llm.example.test/v1");
    vi.stubEnv("REEF_LLM_MODEL", "model-a");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "reef-web",
      capability: "reef-llm-capability-v1",
      llm: { enabled: true, state: "enabled" },
    });
  });

  it("keeps Reef ready when the optional LLM capability is disabled", async () => {
    clearLlmEnv();

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "reef-web",
      capability: "reef-llm-capability-v1",
      llm: { enabled: false, state: "disabled" },
    });
  });

  it("returns 503 only for an invalid LLM configuration", async () => {
    clearLlmEnv();
    vi.stubEnv("REEF_LLM_API_KEY", "partial-key");

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      service: "reef-web",
      capability: "reef-llm-capability-v1",
      llm: { enabled: false, state: "invalid" },
    });
  });
});
