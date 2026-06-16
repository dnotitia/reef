// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const { mockAkbListTemplates, mockCreateAkbAdapter } = vi.hoisted(() => ({
  mockAkbListTemplates: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListTemplates: mockAkbListTemplates,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError, NotFoundError } from "@reef/core";
import { VALID_JWT } from "../__test-helpers__/jwt";
import { GET } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

describe("GET /api/templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 400 when vault param is missing", async () => {
    const req = new Request("http://localhost/api/templates", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when session cookie is missing", async () => {
    const req = new Request("http://localhost/api/templates?vault=reef-acme");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns { entries } on happy path", async () => {
    const entries = [{ name: "bug", label: "Bug", description: "Bug report" }];
    mockAkbListTemplates.mockResolvedValueOnce(entries);
    const req = new Request("http://localhost/api/templates?vault=reef-acme", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries });
  });

  it("returns { entries: [] } when akb returns NotFoundError (first-run)", async () => {
    mockAkbListTemplates.mockRejectedValueOnce(
      new NotFoundError({ resource: "templates" }),
    );
    const req = new Request("http://localhost/api/templates?vault=reef-acme", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });

  it("translates AuthError to 401", async () => {
    mockAkbListTemplates.mockRejectedValueOnce(new AuthError({}));
    const req = new Request("http://localhost/api/templates?vault=reef-acme", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
