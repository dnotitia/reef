// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const { mockRevokeVaultMember, mockGetCurrentActor, mockCreateAkbAdapter } =
  vi.hoisted(() => ({
    mockRevokeVaultMember: vi.fn(),
    mockGetCurrentActor: vi.fn(),
    mockCreateAkbAdapter: vi.fn(),
  }));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbRevokeVaultMember: mockRevokeVaultMember,
    akbGetCurrentActor: mockGetCurrentActor,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError } from "@reef/core";
import { VALID_JWT } from "../../../../__test-helpers__/jwt";
import { DELETE } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

function ctx(vault = "reef-acme", user = "bob") {
  return { params: Promise.resolve({ vault, user }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
  // Default: the caller is someone other than the revoke target.
  mockGetCurrentActor.mockResolvedValue({ actor: "admin-user" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("DELETE /api/vaults/[vault]/members/[user]", () => {
  it("revokes the member and returns { revoked: true }", async () => {
    mockRevokeVaultMember.mockResolvedValueOnce(undefined);
    const req = new Request(
      "http://localhost/api/vaults/reef-acme/members/bob",
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE(req, ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });
    expect(mockRevokeVaultMember).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme", user: "bob" }),
    );
  });

  it("rejects self-removal with 409 and never calls revoke", async () => {
    mockGetCurrentActor.mockResolvedValueOnce({ actor: "bob" });
    const req = new Request(
      "http://localhost/api/vaults/reef-acme/members/bob",
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE(req, ctx("reef-acme", "bob"));
    expect(res.status).toBe(409);
    expect(mockRevokeVaultMember).not.toHaveBeenCalled();
  });

  it("passes a non-ASCII username through to core", async () => {
    mockRevokeVaultMember.mockResolvedValueOnce(undefined);
    const req = new Request(
      "http://localhost/api/vaults/reef-acme/members/%ED%85%8C%EC%8A%A4%ED%8A%B8",
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE(req, ctx("reef-acme", "테스트"));
    expect(res.status).toBe(200);
    expect(mockRevokeVaultMember).toHaveBeenCalledWith(
      expect.objectContaining({ user: "테스트" }),
    );
  });

  it("returns 400 for a malformed vault", async () => {
    const req = new Request("http://localhost/api/vaults/BAD/members/bob", {
      method: "DELETE",
      headers: authedHeaders(),
    });
    const res = await DELETE(req, ctx("BAD VAULT"));
    expect(res.status).toBe(400);
  });

  it("returns 401 without a session cookie", async () => {
    const req = new Request(
      "http://localhost/api/vaults/reef-acme/members/bob",
      { method: "DELETE" },
    );
    const res = await DELETE(req, ctx());
    expect(res.status).toBe(401);
  });

  it("folds an akb owner/admin guard (403) into 401", async () => {
    mockRevokeVaultMember.mockRejectedValueOnce(new AuthError({}));
    const req = new Request(
      "http://localhost/api/vaults/reef-acme/members/alice",
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE(req, ctx("reef-acme", "alice"));
    expect(res.status).toBe(401);
  });
});
