// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const { mockAkbListVaultMembers, mockCreateAkbAdapter } = vi.hoisted(() => ({
  mockAkbListVaultMembers: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListVaultMembers: mockAkbListVaultMembers,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError } from "@reef/core";
import { VALID_JWT } from "../__test-helpers__/jwt";
import { GET } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

const MEMBERS = [
  { username: "alice", display_name: "Alice Anderson", role: "admin" },
  { username: "bob", display_name: "Bob Brown", role: "writer" },
  { username: "carol", display_name: null, role: "reader" },
  { username: "dana", display_name: "Dana Doe", role: "owner" },
  { username: "eve", display_name: "Eve Example", role: "member" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/vault-members", () => {
  it("returns 400 when vault param is missing", async () => {
    const req = new Request("http://localhost/api/vault-members", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when vault param is malformed", async () => {
    const req = new Request(
      "http://localhost/api/vault-members?vault=BAD%20VAULT",
      { headers: authedHeaders() },
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when session cookie is missing", async () => {
    const req = new Request(
      "http://localhost/api/vault-members?vault=reef-acme",
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns only assignable roles mapped to Collaborator shape when q is empty", async () => {
    mockAkbListVaultMembers.mockResolvedValueOnce({ members: MEMBERS });
    const req = new Request(
      "http://localhost/api/vault-members?vault=reef-acme",
      { headers: authedHeaders() },
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users[0]).toEqual({
      login: "alice",
      name: "Alice Anderson",
      avatar_url: null,
    });
    expect(body.users.map((user: { login: string }) => user.login)).toEqual([
      "alice",
      "bob",
      "dana",
    ]);
  });

  it("filters by q substring (case insensitive)", async () => {
    mockAkbListVaultMembers.mockResolvedValueOnce({ members: MEMBERS });
    const req = new Request(
      "http://localhost/api/vault-members?vault=reef-acme&q=AL",
      { headers: authedHeaders() },
    );
    const res = await GET(req);
    const body = await res.json();
    expect(body.users.map((u: { login: string }) => u.login)).toEqual([
      "alice",
    ]);
  });

  it("returns every assignable result without a cap", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      username: `user${i.toString().padStart(2, "0")}`,
      display_name: `User ${i}`,
      role: i === 24 ? "reader" : "writer",
    }));
    mockAkbListVaultMembers.mockResolvedValueOnce({ members: many });
    const req = new Request(
      "http://localhost/api/vault-members?vault=reef-acme&q=user",
      { headers: authedHeaders() },
    );
    const res = await GET(req);
    const body = await res.json();
    expect(body.users).toHaveLength(24);
  });

  it("translates AuthError to 401", async () => {
    mockAkbListVaultMembers.mockRejectedValueOnce(new AuthError({}));
    const req = new Request(
      "http://localhost/api/vault-members?vault=reef-acme",
      { headers: authedHeaders() },
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
