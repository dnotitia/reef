// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/ai/managed-platform", () => {
  it("returns 200 only for a complete hard gateway profile", async () => {
    vi.stubEnv("REEF_LLM_API_KEY", "gateway-key");
    vi.stubEnv("REEF_LLM_BASE_URL", "https://gateway.example.test/v1");
    vi.stubEnv("REEF_LLM_MODEL", "model-a");
    vi.stubEnv("REEF_LLM_GOVERNANCE_MODE", "platform_hard");
    vi.stubEnv(
      "REEF_PLATFORM_GATEWAY_BASE_URL",
      "https://gateway.example.test/v1",
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "reef-web",
      capability: "reef-managed-platform-v1",
      llmGovernanceMode: "platform_hard",
    });
  });

  it("returns 503 for the standalone compatibility profile", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "provider-key");
    vi.stubEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1");
    vi.stubEnv("REEF_LLM_MODEL", "model-a");

    const response = await GET();

    expect(response.status).toBe(503);
  });
});
