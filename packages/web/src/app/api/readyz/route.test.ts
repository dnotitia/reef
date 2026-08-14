// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkReadiness: vi.fn(),
  getRuntime: vi.fn(),
  readConfig: vi.fn(),
}));

vi.mock("@/server/auth/config", () => ({
  readAuthRuntimeConfig: mocks.readConfig,
}));

vi.mock("@/server/auth/runtime", () => ({
  getSsoAuthRuntime: mocks.getRuntime,
}));

import { GET } from "./route";

describe("GET /api/readyz", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps local-mode readiness dependency-free", async () => {
    mocks.readConfig.mockReturnValue({ mode: "local" });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(mocks.getRuntime).not.toHaveBeenCalled();
  });

  it("proves Redis and in-cluster OIDC reachability in SSO mode", async () => {
    mocks.readConfig.mockReturnValue({ mode: "sso" });
    mocks.checkReadiness.mockResolvedValue(undefined);
    mocks.getRuntime.mockResolvedValue({
      checkReadiness: mocks.checkReadiness,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(mocks.checkReadiness).toHaveBeenCalledOnce();
  });

  it("returns a credential-free 503 when a dependency is unavailable", async () => {
    mocks.readConfig.mockReturnValue({ mode: "sso" });
    mocks.getRuntime.mockRejectedValue(
      new Error("redis://user:secret@redis.internal"),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(JSON.stringify([...response.headers])).not.toContain("secret");
  });
});
