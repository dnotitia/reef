// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const { mockAkbReadConfig, mockAkbWriteConfig, mockCreateAkbAdapter } =
  vi.hoisted(() => ({
    mockAkbReadConfig: vi.fn(),
    mockAkbWriteConfig: vi.fn(),
    mockCreateAkbAdapter: vi.fn(),
  }));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbReadConfig: mockAkbReadConfig,
    akbWriteConfig: mockAkbWriteConfig,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError, type Config, NotFoundError } from "@reef/core";
import { VALID_JWT } from "../__test-helpers__/jwt";
import { GET, PATCH } from "./route";

function authedHeaders(): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
    "content-type": "application/json",
  };
}

const BASE_CONFIG: Config = {
  project_prefix: "REEF",
  monitored_repos: [{ github_id: 123456, owner: "octo", name: "cat" }],
  authoring_language: null,
  stale_hide_completed_days: 28,
  stale_hide_canceled_days: 7,
  ai_scanning_enabled: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/config", () => {
  it("returns 400 when vault param is missing", async () => {
    const req = new Request("http://localhost/api/config", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when session cookie is missing", async () => {
    const req = new Request("http://localhost/api/config?vault=reef-acme");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns { config } on happy path", async () => {
    mockAkbReadConfig.mockResolvedValueOnce({
      config: BASE_CONFIG,
      exists: true,
    });
    const req = new Request("http://localhost/api/config?vault=reef-acme", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ config: BASE_CONFIG });
  });

  it("translates NotFoundError to 404 with config label", async () => {
    mockAkbReadConfig.mockRejectedValueOnce(
      new NotFoundError({ resource: "config" }),
    );
    const req = new Request("http://localhost/api/config?vault=reef-acme", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("Workspace not found");
  });
});

describe("PATCH /api/config", () => {
  it("returns 400 when JSON body is malformed", async () => {
    const req = new Request("http://localhost/api/config", {
      method: "PATCH",
      headers: authedHeaders(),
      body: "{ not-json",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when patch is empty (refine rejects {})", async () => {
    const req = new Request("http://localhost/api/config", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify({ vault: "reef-acme", patch: {} }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when project_prefix is lowercase (regex reject)", async () => {
    const req = new Request("http://localhost/api/config", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        patch: { project_prefix: "lower" },
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when a resolved auto-hide window is negative or fractional", async () => {
    const negative = new Request("http://localhost/api/config", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        patch: { stale_hide_completed_days: -1 },
      }),
    });
    expect((await PATCH(negative)).status).toBe(400);

    const fractional = new Request("http://localhost/api/config", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        patch: { stale_hide_canceled_days: 2.5 },
      }),
    });
    expect((await PATCH(fractional)).status).toBe(400);
  });

  it("merges patch into existing config and writes via akb", async () => {
    mockAkbReadConfig.mockResolvedValueOnce({
      config: BASE_CONFIG,
      exists: true,
    });
    mockAkbWriteConfig.mockResolvedValueOnce({
      path: "_reef/config.md",
      commit_hash: "c1",
    });

    const req = new Request("http://localhost/api/config", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        patch: { project_prefix: "ACME" },
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // project_prefix updated, monitored_repos preserved
    expect(body.config.project_prefix).toBe("ACME");
    expect(body.config.monitored_repos).toEqual(BASE_CONFIG.monitored_repos);
    expect(mockAkbWriteConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        config: expect.objectContaining({
          project_prefix: "ACME",
          stale_hide_completed_days: 28,
          stale_hide_canceled_days: 7,
        }),
      }),
    );
  });

  it("merges resolved auto-hide windows into existing config", async () => {
    mockAkbReadConfig.mockResolvedValueOnce({
      config: BASE_CONFIG,
      exists: true,
    });
    mockAkbWriteConfig.mockResolvedValueOnce({
      path: "_reef/config.md",
      commit_hash: "c1",
    });

    const req = new Request("http://localhost/api/config", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        patch: {
          stale_hide_completed_days: 14,
          stale_hide_canceled_days: 3,
        },
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.stale_hide_completed_days).toBe(14);
    expect(body.config.stale_hide_canceled_days).toBe(3);
    expect(mockAkbWriteConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          project_prefix: "REEF",
          stale_hide_completed_days: 14,
          stale_hide_canceled_days: 3,
        }),
      }),
    );
  });

  it("preserves project_prefix when patch only touches monitored_repos", async () => {
    mockAkbReadConfig.mockResolvedValueOnce({
      config: BASE_CONFIG,
      exists: true,
    });
    mockAkbWriteConfig.mockResolvedValueOnce({
      path: "_reef/config.md",
      commit_hash: "c1",
    });

    const req = new Request("http://localhost/api/config", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        patch: { monitored_repos: [] },
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.project_prefix).toBe(BASE_CONFIG.project_prefix);
    expect(body.config.monitored_repos).toEqual([]);
  });

  it("merges the ai_scanning_enabled switch into existing config (REEF-313)", async () => {
    mockAkbReadConfig.mockResolvedValueOnce({
      config: BASE_CONFIG,
      exists: true,
    });
    mockAkbWriteConfig.mockResolvedValueOnce({
      path: "_reef/config.md",
      commit_hash: "c1",
    });

    const req = new Request("http://localhost/api/config", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        patch: { ai_scanning_enabled: true },
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.ai_scanning_enabled).toBe(true);
    // Other fields are preserved through the merge.
    expect(body.config.project_prefix).toBe(BASE_CONFIG.project_prefix);
    expect(mockAkbWriteConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ ai_scanning_enabled: true }),
      }),
    );
  });

  it("translates AuthError to 401", async () => {
    mockAkbReadConfig.mockRejectedValueOnce(new AuthError({}));
    const req = new Request("http://localhost/api/config", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        patch: { project_prefix: "ACME" },
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });
});
