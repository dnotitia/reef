// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const {
  mockListVaultMembers,
  mockGrantVaultMember,
  mockGetCurrentActor,
  mockCreateAkbAdapter,
} = vi.hoisted(() => ({
  mockListVaultMembers: vi.fn(),
  mockGrantVaultMember: vi.fn(),
  mockGetCurrentActor: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListVaultMembers: mockListVaultMembers,
    akbGrantVaultMember: mockGrantVaultMember,
    akbGetCurrentActor: mockGetCurrentActor,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError } from "@reef/core";
import { VALID_JWT } from "../../../__test-helpers__/jwt";
import { GET, POST } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

function ctx(vault = "reef-acme") {
  return { params: Promise.resolve({ vault }) };
}

const ROSTER = [
  { username: "alice", display_name: "Alice", role: "owner" },
  { username: "bob", display_name: "Bob", role: "writer", since: "2026-01-01" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
  // Default: the caller is someone other than the grant target.
  mockGetCurrentActor.mockResolvedValue({ actor: "admin-user" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/vaults/[vault]/members", () => {
  it("returns the role-bearing roster", async () => {
    mockListVaultMembers.mockResolvedValueOnce({ members: ROSTER });
    const req = new Request("http://localhost/api/vaults/reef-acme/members", {
      headers: authedHeaders(),
    });
    const res = await GET(req, ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(2);
    expect(body.members[0]).toMatchObject({ username: "alice", role: "owner" });
    expect(body.members[1].role).toBe("writer");
  });

  it("returns 400 for a malformed vault", async () => {
    const req = new Request("http://localhost/api/vaults/BAD/members", {
      headers: authedHeaders(),
    });
    const res = await GET(req, ctx("BAD VAULT"));
    expect(res.status).toBe(400);
  });

  it("returns 401 without a session cookie", async () => {
    const req = new Request("http://localhost/api/vaults/reef-acme/members");
    const res = await GET(req, ctx());
    expect(res.status).toBe(401);
  });

  it("translates AuthError to 401", async () => {
    mockListVaultMembers.mockRejectedValueOnce(new AuthError({}));
    const req = new Request("http://localhost/api/vaults/reef-acme/members", {
      headers: authedHeaders(),
    });
    const res = await GET(req, ctx());
    expect(res.status).toBe(401);
  });
});

describe("POST /api/vaults/[vault]/members", () => {
  it("grants a role and echoes the result", async () => {
    mockGrantVaultMember.mockResolvedValueOnce({
      vault: "reef-acme",
      user: "carol",
      role: "writer",
    });
    const req = new Request("http://localhost/api/vaults/reef-acme/members", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ user: "carol", role: "writer" }),
    });
    const res = await POST(req, ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      vault: "reef-acme",
      user: "carol",
      role: "writer",
    });
    expect(mockGrantVaultMember).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        user: "carol",
        role: "writer",
      }),
    );
  });

  it("rejects a self-role-change with 409 and never calls grant", async () => {
    mockGetCurrentActor.mockResolvedValueOnce({ actor: "dana" });
    const req = new Request("http://localhost/api/vaults/reef-acme/members", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ user: "dana", role: "reader" }),
    });
    const res = await POST(req, ctx());
    expect(res.status).toBe(409);
    expect(mockGrantVaultMember).not.toHaveBeenCalled();
  });

  it("rejects a role outside reader/writer/admin (e.g. owner) with 400", async () => {
    const req = new Request("http://localhost/api/vaults/reef-acme/members", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ user: "carol", role: "owner" }),
    });
    const res = await POST(req, ctx());
    expect(res.status).toBe(400);
    expect(mockGrantVaultMember).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON", async () => {
    const req = new Request("http://localhost/api/vaults/reef-acme/members", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req, ctx());
    expect(res.status).toBe(400);
  });

  it("folds an akb admin-floor rejection (403) into 401", async () => {
    mockGrantVaultMember.mockRejectedValueOnce(new AuthError({}));
    const req = new Request("http://localhost/api/vaults/reef-acme/members", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ user: "carol", role: "admin" }),
    });
    const res = await POST(req, ctx());
    expect(res.status).toBe(401);
  });
});
