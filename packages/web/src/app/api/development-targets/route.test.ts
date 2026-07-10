// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/server/developmentProfiles", async () => {
  const core = await import("@reef/core");
  return {
    getDevelopmentProfileCatalog: () =>
      core.DEFAULT_DEVELOPMENT_PROFILE_CATALOG,
  };
});

const { mockListTargets, mockCreateAkbAdapter } = vi.hoisted(() => ({
  mockListTargets: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListDevelopmentTargets: mockListTargets,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../__test-helpers__/jwt";
import { GET } from "./route";

function request(vault = "reef-acme") {
  return new Request(
    `http://localhost/api/development-targets?vault=${vault}`,
    { headers: { cookie: `${SESSION_COOKIE}=${VALID_JWT}` } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/development-targets", () => {
  it("returns joined targets and safe profile metadata", async () => {
    mockListTargets.mockResolvedValueOnce([
      {
        repo: { github_id: 1001, owner: "octo", name: "reef" },
        config: null,
        eligibility: { eligible: false, reason: "target_missing" },
      },
    ]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items[0].repo).toEqual({
      github_id: 1001,
      owner: "octo",
      name: "reef",
    });
    expect(body.catalog.runner_profiles[0]).toEqual(
      expect.objectContaining({ id: "default", label: expect.any(String) }),
    );
    expect(JSON.stringify(body)).not.toMatch(/credential|filesystem|network/);
  });

  it("requires a valid vault and a session", async () => {
    expect((await GET(request(""))).status).toBe(400);
    expect(
      (
        await GET(
          new Request(
            "http://localhost/api/development-targets?vault=reef-acme",
          ),
        )
      ).status,
    ).toBe(401);
  });
});
