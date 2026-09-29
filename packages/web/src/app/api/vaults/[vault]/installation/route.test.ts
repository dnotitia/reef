// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const {
  mockAkbListVaults,
  mockCreateAkbAdapter,
  mockReadWorkspaceInstallationState,
  mockRequestWorkspaceInstallation,
  mockUninstallWorkspaceInstallation,
} = vi.hoisted(() => ({
  mockAkbListVaults: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
  mockReadWorkspaceInstallationState: vi.fn(),
  mockRequestWorkspaceInstallation: vi.fn(),
  mockUninstallWorkspaceInstallation: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListVaults: mockAkbListVaults,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

vi.mock("@/server/adapters/workspaceInstallation", () => ({
  readWorkspaceInstallationState: mockReadWorkspaceInstallationState,
  requestWorkspaceInstallation: mockRequestWorkspaceInstallation,
  uninstallWorkspaceInstallation: mockUninstallWorkspaceInstallation,
}));

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError } from "@reef/core";
import { VALID_JWT } from "../../../__test-helpers__/jwt";
import { DELETE, GET, POST } from "./route";

const VAULT = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "reef-acme",
  role: "owner",
};

function request(method = "GET", body?: unknown): Request {
  return new Request("http://localhost/api/vaults/reef-acme/installation", {
    method,
    headers: {
      cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const params = { params: Promise.resolve({ vault: "reef-acme" }) };

describe("/api/vaults/[vault]/installation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
    mockAkbListVaults.mockResolvedValue({ vaults: [VAULT] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads canonical state without caching it", async () => {
    mockReadWorkspaceInstallationState.mockResolvedValueOnce({
      installation_status: "not_installed",
    });

    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      installation_status: "not_installed",
    });
    expect(mockReadWorkspaceInstallationState).toHaveBeenCalledWith({
      adapter: expect.any(Object),
      vault: VAULT,
    });
  });

  it("sends an explicit install mode and returns acknowledgement separately from readiness", async () => {
    const installation = {
      installationId: "33333333-3333-4333-8333-333333333333",
      appId: "11111111-1111-4111-8111-111111111111",
      vaultId: VAULT.id,
      lifecycle: "active",
    };
    mockRequestWorkspaceInstallation.mockResolvedValueOnce({
      installation,
      commandStatus: "accepted",
      replayed: false,
    });
    mockReadWorkspaceInstallationState.mockResolvedValueOnce({
      installation_status: "ready",
      installation,
    });

    const response = await POST(request("POST", { mode: "install" }), params);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      installation_status: "ready",
      installation,
      command_status: "accepted",
      replayed: false,
    });
    expect(mockRequestWorkspaceInstallation).toHaveBeenCalledWith({
      adapter: expect.any(Object),
      vault: VAULT,
      mode: "install",
    });
    expect(mockReadWorkspaceInstallationState).toHaveBeenCalledTimes(1);
  });

  it("rejects client-supplied release identity and unauthenticated commands", async () => {
    const invalid = await POST(
      request("POST", {
        mode: "fresh",
        release_id: "11111111-1111-4111-8111-111111111111",
      }),
      params,
    );
    expect(invalid.status).toBe(400);
    expect(mockRequestWorkspaceInstallation).not.toHaveBeenCalled();

    const unauthenticated = new Request(
      "http://localhost/api/vaults/reef-acme/installation",
      { method: "POST", body: JSON.stringify({ mode: "install" }) },
    );
    expect((await POST(unauthenticated, params)).status).toBe(401);
  });

  it("preserves the signed-in session on a resource permission denial", async () => {
    mockReadWorkspaceInstallationState.mockRejectedValueOnce(
      new AuthError({ origin: "akb", status: 403 }),
    );

    const response = await GET(request(), params);

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("uninstalls through AKB and reports the terminal state separately", async () => {
    mockUninstallWorkspaceInstallation.mockResolvedValueOnce({
      installation: {
        installationId: "33333333-3333-4333-8333-333333333333",
        appId: "11111111-1111-4111-8111-111111111111",
        vaultId: VAULT.id,
        lifecycle: "uninstalled",
      },
      commandStatus: "accepted",
      replayed: false,
    });

    const response = await DELETE(request("DELETE"), params);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      installation_status: "uninstalled",
      command_status: "accepted",
      replayed: false,
    });
    expect(mockUninstallWorkspaceInstallation).toHaveBeenCalledWith({
      adapter: expect.any(Object),
      vault: VAULT,
    });
  });
});
