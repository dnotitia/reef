// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

const {
  mockDetachReef,
  mockGetCurrentActor,
  mockCreateAkbAdapter,
  mockListVaults,
} = vi.hoisted(() => ({
  mockDetachReef: vi.fn(),
  mockGetCurrentActor: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
  mockListVaults: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbDetachReef: mockDetachReef,
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
} from "../../../__test-helpers__/routeMocks";
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

describe("DELETE /api/vaults/[vault]/reef", () => {
  it("detaches reef and returns { detached: true }, forwarding the actor", async () => {
    mockDetachReef.mockResolvedValueOnce(undefined);
    const req = new Request("http://localhost/api/vaults/reef-acme/reef", {
      method: "DELETE",
      headers: authedHeaders(),
    });
    const res = await DELETE(req, vaultRouteContext());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detached: true });
    expect(mockDetachReef).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme", actor: "alice" }),
    );
  });

  it("returns 400 for a malformed vault and never calls detach", async () => {
    const req = new Request("http://localhost/api/vaults/BAD/reef", {
      method: "DELETE",
      headers: authedHeaders(),
    });
    const res = await DELETE(req, vaultRouteContext("BAD VAULT"));
    expect(res.status).toBe(400);
    expect(mockDetachReef).not.toHaveBeenCalled();
  });

  it("returns 401 without a session cookie and never calls detach", async () => {
    const req = new Request("http://localhost/api/vaults/reef-acme/reef", {
      method: "DELETE",
    });
    const res = await DELETE(req, vaultRouteContext());
    expect(res.status).toBe(401);
    expect(mockDetachReef).not.toHaveBeenCalled();
  });

  it("folds an akb admin guard (403) into 401", async () => {
    mockDetachReef.mockRejectedValueOnce(new AuthError({}));
    const req = new Request("http://localhost/api/vaults/reef-acme/reef", {
      method: "DELETE",
      headers: authedHeaders(),
    });
    const res = await DELETE(req, vaultRouteContext());
    expect(res.status).toBe(401);
  });

  it("rejects a non-owner (admin) with 403 and never calls detach", async () => {
    // Server-enforces owner-scoped even though dropping reef tables is an akb
    // admin-floor operation (REEF-322).
    mockListVaults.mockResolvedValueOnce({
      vaults: [{ name: "reef-acme", role: "admin" }],
    });
    const req = new Request("http://localhost/api/vaults/reef-acme/reef", {
      method: "DELETE",
      headers: authedHeaders(),
    });
    const res = await DELETE(req, vaultRouteContext());
    expect(res.status).toBe(403);
    expect(mockDetachReef).not.toHaveBeenCalled();
  });
});
