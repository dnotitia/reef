// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAkbAdapter, mockGetAkbCurrentActor, mockListMyWork } =
  vi.hoisted(() => ({
    mockGetAkbAdapter: vi.fn(),
    mockGetAkbCurrentActor: vi.fn(),
    mockListMyWork: vi.fn(),
  }));

vi.mock("@/lib/api/requestHelpers", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/requestHelpers")
  >("@/lib/api/requestHelpers");
  return {
    ...actual,
    getAkbAdapter: mockGetAkbAdapter,
    getAkbCurrentActor: mockGetAkbCurrentActor,
  };
});

vi.mock("@/lib/logging/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/server/application/myWork/listMyWork", () => ({
  listMyWork: mockListMyWork,
}));

import { GET } from "./route";

describe("GET /api/my-work", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockGetAkbAdapter.mockReturnValue({ adapter: { request: vi.fn() } });
    mockGetAkbCurrentActor.mockResolvedValue({ actor: "alice" });
    mockListMyWork.mockResolvedValue({
      workspaces: [],
      issues: [],
      next_offset: null,
      as_of: "2026-10-06T00:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses the authenticated server actor and disables response caching", async () => {
    const response = await GET(
      new Request("http://localhost/api/my-work?limit=25&offset=50&actor=bob"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      workspaces: [],
      issues: [],
      next_offset: null,
    });
    expect(mockGetAkbCurrentActor).toHaveBeenCalledTimes(1);
    expect(mockListMyWork).toHaveBeenCalledWith({
      adapter: expect.any(Object),
      actor: "alice",
      query: { limit: 25, offset: 50 },
    });
  });

  it("rejects invalid global pagination before querying work", async () => {
    const response = await GET(
      new Request("http://localhost/api/my-work?limit=0&offset=-1"),
    );

    expect(response.status).toBe(400);
    expect(mockListMyWork).not.toHaveBeenCalled();
  });
});
