// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

const { mockDetachReef, mockGetCurrentActor, mockCreateAkbAdapter } =
  vi.hoisted(() => ({
    mockDetachReef: vi.fn(),
    mockGetCurrentActor: vi.fn(),
    mockCreateAkbAdapter: vi.fn(),
  }));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbDetachReef: mockDetachReef,
    akbGetCurrentActor: mockGetCurrentActor,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError } from "@reef/core";
import { VALID_JWT } from "../../../__test-helpers__/jwt";
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
    const res = await DELETE(req, ctx());
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
    const res = await DELETE(req, ctx("BAD VAULT"));
    expect(res.status).toBe(400);
    expect(mockDetachReef).not.toHaveBeenCalled();
  });

  it("returns 401 without a session cookie and never calls detach", async () => {
    const req = new Request("http://localhost/api/vaults/reef-acme/reef", {
      method: "DELETE",
    });
    const res = await DELETE(req, ctx());
    expect(res.status).toBe(401);
    expect(mockDetachReef).not.toHaveBeenCalled();
  });

  it("folds an akb admin guard (403) into 401", async () => {
    mockDetachReef.mockRejectedValueOnce(new AuthError({}));
    const req = new Request("http://localhost/api/vaults/reef-acme/reef", {
      method: "DELETE",
      headers: authedHeaders(),
    });
    const res = await DELETE(req, ctx());
    expect(res.status).toBe(401);
  });
});
