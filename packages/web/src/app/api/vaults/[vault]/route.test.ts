// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

const {
  mockDeleteVault,
  mockGetCurrentActor,
  mockCreateAkbAdapter,
  mockListVaults,
} = vi.hoisted(() => ({
  mockDeleteVault: vi.fn(),
  mockGetCurrentActor: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
  mockListVaults: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbDeleteVault: mockDeleteVault,
    akbGetCurrentActor: mockGetCurrentActor,
    akbListVaults: mockListVaults,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError } from "@reef/core";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { DELETE } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

function ctx(vault = "reef-acme") {
  return { params: Promise.resolve({ vault }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
  mockGetCurrentActor.mockResolvedValue({ actor: "alice" });
  // Default: the caller owns the vault (owner-only gate passes).
  mockListVaults.mockResolvedValue({
    vaults: [{ name: "reef-acme", role: "owner" }],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("DELETE /api/vaults/[vault]", () => {
  it("deletes the vault and returns { deleted: true }, forwarding the actor", async () => {
    mockDeleteVault.mockResolvedValueOnce(undefined);
    const req = new Request("http://localhost/api/vaults/reef-acme", {
      method: "DELETE",
      headers: authedHeaders(),
    });
    const res = await DELETE(req, ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(mockDeleteVault).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme", actor: "alice" }),
    );
  });

  it("returns 400 for a malformed vault and never calls delete", async () => {
    const req = new Request("http://localhost/api/vaults/BAD", {
      method: "DELETE",
      headers: authedHeaders(),
    });
    const res = await DELETE(req, ctx("BAD VAULT"));
    expect(res.status).toBe(400);
    expect(mockDeleteVault).not.toHaveBeenCalled();
  });

  it("returns 401 without a session cookie and never calls delete", async () => {
    const req = new Request("http://localhost/api/vaults/reef-acme", {
      method: "DELETE",
    });
    const res = await DELETE(req, ctx());
    expect(res.status).toBe(401);
    expect(mockDeleteVault).not.toHaveBeenCalled();
  });

  it("folds an akb admin/owner guard (403) into 401", async () => {
    mockDeleteVault.mockRejectedValueOnce(new AuthError({}));
    const req = new Request("http://localhost/api/vaults/reef-acme", {
      method: "DELETE",
      headers: authedHeaders(),
    });
    const res = await DELETE(req, ctx());
    expect(res.status).toBe(401);
  });

  it("rejects a non-owner (admin) with 403 and never calls delete", async () => {
    // Server-enforces owner-only even though akb's own floor is admin (REEF-322).
    mockListVaults.mockResolvedValueOnce({
      vaults: [{ name: "reef-acme", role: "admin" }],
    });
    const req = new Request("http://localhost/api/vaults/reef-acme", {
      method: "DELETE",
      headers: authedHeaders(),
    });
    const res = await DELETE(req, ctx());
    expect(res.status).toBe(403);
    expect(mockDeleteVault).not.toHaveBeenCalled();
  });
});
