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

import { AuthError } from "@reef/core";
import {
  authedHeaders,
  stubOwnedVaultRoute,
  vaultRouteContext,
} from "../../__test-helpers__/routeMocks";
import { DELETE } from "./route";

beforeEach(() => {
  stubOwnedVaultRoute({
    mockCreateAkbAdapter,
    mockGetCurrentActor,
    mockListVaults,
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
    const res = await DELETE(req, vaultRouteContext());
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
    const res = await DELETE(req, vaultRouteContext("BAD VAULT"));
    expect(res.status).toBe(400);
    expect(mockDeleteVault).not.toHaveBeenCalled();
  });

  it("returns 401 without a session cookie and never calls delete", async () => {
    const req = new Request("http://localhost/api/vaults/reef-acme", {
      method: "DELETE",
    });
    const res = await DELETE(req, vaultRouteContext());
    expect(res.status).toBe(401);
    expect(mockDeleteVault).not.toHaveBeenCalled();
  });

  it("folds an akb admin/owner guard (403) into 401", async () => {
    mockDeleteVault.mockRejectedValueOnce(new AuthError({}));
    const req = new Request("http://localhost/api/vaults/reef-acme", {
      method: "DELETE",
      headers: authedHeaders(),
    });
    const res = await DELETE(req, vaultRouteContext());
    expect(res.status).toBe(401);
  });

  it("rejects a non-owner (admin) with 403 and never calls delete", async () => {
    // Server-enforces owner-scoped even though akb's own floor is admin (REEF-322).
    mockListVaults.mockResolvedValueOnce({
      vaults: [{ name: "reef-acme", role: "admin" }],
    });
    const req = new Request("http://localhost/api/vaults/reef-acme", {
      method: "DELETE",
      headers: authedHeaders(),
    });
    const res = await DELETE(req, vaultRouteContext());
    expect(res.status).toBe(403);
    expect(mockDeleteVault).not.toHaveBeenCalled();
  });
});
