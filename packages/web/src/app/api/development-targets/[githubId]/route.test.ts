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

const { mockWriteTarget, mockListVaults, mockCreateAkbAdapter } = vi.hoisted(
  () => ({
    mockWriteTarget: vi.fn(),
    mockListVaults: vi.fn(),
    mockCreateAkbAdapter: vi.fn(),
  }),
);

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbWriteDevelopmentTarget: mockWriteTarget,
    akbListVaults: mockListVaults,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { DevelopmentTargetError } from "@reef/core";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { PUT } from "./route";

const target = {
  enabled: true,
  recipe_path: ".reef/agent.yml",
  runner_profile: "default",
  permission_profile: ":workspace",
  branch_template: "agent/{issue_id}/{run_id}",
};

function request(body: unknown) {
  return new Request("http://localhost/api/development-targets/1001", {
    method: "PUT",
    headers: {
      cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ githubId: "1001" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
  mockListVaults.mockResolvedValue({
    vaults: [{ name: "reef-acme", role: "admin" }],
  });
  mockWriteTarget.mockImplementation(async ({ target: input }) => input);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("PUT /api/development-targets/[githubId]", () => {
  it("rejects an invalid GitHub repository id", async () => {
    const response = await PUT(request({ vault: "reef-acme", target }), {
      params: Promise.resolve({ githubId: "not-a-number" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid GitHub repository id.",
    });
    expect(mockWriteTarget).not.toHaveBeenCalled();
  });

  it("allows admin and persists a full replacement", async () => {
    const response = await PUT(
      request({ vault: "reef-acme", target }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mockWriteTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        target: { github_id: 1001, ...target },
      }),
    );
  });

  it("rejects writer mutation before the adapter write", async () => {
    mockListVaults.mockResolvedValueOnce({
      vaults: [{ name: "reef-acme", role: "writer" }],
    });
    const response = await PUT(
      request({ vault: "reef-acme", target }),
      context,
    );
    expect(response.status).toBe(403);
    expect(mockWriteTarget).not.toHaveBeenCalled();
  });

  it("returns 422 when the github id is not monitored", async () => {
    mockWriteTarget.mockRejectedValueOnce(
      new DevelopmentTargetError("unmonitored"),
    );
    const response = await PUT(
      request({ vault: "reef-acme", target }),
      context,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(
      expect.objectContaining({ error: expect.stringContaining("monitored") }),
    );
  });

  it("rejects raw policy fields and invalid recipe paths", async () => {
    const response = await PUT(
      request({
        vault: "reef-acme",
        target: { ...target, recipe_path: "../secret", network: ["*"] },
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect(mockWriteTarget).not.toHaveBeenCalled();
  });

  it("returns 400 when an enabled target omits required fields", async () => {
    const response = await PUT(
      request({ vault: "reef-acme", target: { enabled: true } }),
      context,
    );
    expect(response.status).toBe(400);
    expect(mockWriteTarget).not.toHaveBeenCalled();
  });
});
