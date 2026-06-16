// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const { mockSearchUsers, mockListVaults, mockCreateAkbAdapter } = vi.hoisted(
  () => ({
    mockSearchUsers: vi.fn(),
    mockListVaults: vi.fn(),
    mockCreateAkbAdapter: vi.fn(),
  }),
);

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbSearchUsers: mockSearchUsers,
    akbListVaults: mockListVaults,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError } from "@reef/core";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { GET } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

function req(qs: string): Request {
  return new Request(`http://localhost/api/users/search?${qs}`, {
    headers: authedHeaders(),
  });
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

describe("GET /api/users/search", () => {
  it("returns trimmed results (no email) for an admin of the named vault", async () => {
    mockListVaults.mockResolvedValueOnce({
      vaults: [{ name: "reef-acme", role: "admin" }],
    });
    mockSearchUsers.mockResolvedValueOnce({
      users: [
        { username: "carol", display_name: "Carol", email: "carol@x.io" },
      ],
    });
    const res = await GET(req("vault=reef-acme&q=car"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toEqual([{ username: "carol", display_name: "Carol" }]);
    expect(body.users[0]).not.toHaveProperty("email");
    expect(mockSearchUsers).toHaveBeenCalledWith(
      expect.objectContaining({ query: "car", limit: 10 }),
    );
  });

  it("returns 400 when the vault param is missing", async () => {
    const res = await GET(req("q=car"));
    expect(res.status).toBe(400);
    expect(mockSearchUsers).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-admin of the vault (no directory enumeration)", async () => {
    mockListVaults.mockResolvedValueOnce({
      vaults: [{ name: "reef-acme", role: "writer" }],
    });
    const res = await GET(req("vault=reef-acme&q=car"));
    expect(res.status).toBe(403);
    expect(mockSearchUsers).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller has no access to the vault", async () => {
    mockListVaults.mockResolvedValueOnce({ vaults: [] });
    const res = await GET(req("vault=reef-acme&q=car"));
    expect(res.status).toBe(403);
    expect(mockSearchUsers).not.toHaveBeenCalled();
  });

  it("returns 401 without a session cookie", async () => {
    const res = await GET(
      new Request("http://localhost/api/users/search?vault=reef-acme&q=car"),
    );
    expect(res.status).toBe(401);
  });

  it("translates AuthError to 401", async () => {
    mockListVaults.mockRejectedValueOnce(new AuthError({}));
    const res = await GET(req("vault=reef-acme&q=car"));
    expect(res.status).toBe(401);
  });
});
