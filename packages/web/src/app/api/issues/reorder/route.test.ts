// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockRouteLogger,
  mockRouteTelemetry,
} from "../../__test-helpers__/routeMocks";

mockRouteTelemetry();
mockRouteLogger();

const { mockGetAkbCurrentActor } = vi.hoisted(() => ({
  mockGetAkbCurrentActor: vi.fn(),
}));

vi.mock("@/lib/api/requestHelpers", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api/requestHelpers")>();
  return { ...original, getAkbCurrentActor: mockGetAkbCurrentActor };
});

const { mockAkbReorderBacklogIssues, mockCreateAkbAdapter } = vi.hoisted(
  () => ({
    mockAkbReorderBacklogIssues: vi.fn(),
    mockCreateAkbAdapter: vi.fn(),
  }),
);

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbReorderBacklogIssues: mockAkbReorderBacklogIssues,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { POST } from "./route";

function authedHeaders(): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
    "content-type": "application/json",
  };
}

function reorderRequest(
  body: unknown,
  headers: Record<string, string> = authedHeaders(),
): Request {
  return new Request("http://localhost/api/issues/reorder", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/issues/reorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
    mockGetAkbCurrentActor.mockResolvedValue({ actor: "carol" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 401 without a session cookie", async () => {
    const res = await POST(
      reorderRequest(
        { vault: "reef-acme", assignments: [{ id: "REEF-1", rank: 1000 }] },
        { "content-type": "application/json" },
      ),
    );
    expect(res.status).toBe(401);
    expect(mockAkbReorderBacklogIssues).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body (empty assignments)", async () => {
    const res = await POST(
      reorderRequest({ vault: "reef-acme", assignments: [] }),
    );
    expect(res.status).toBe(400);
    expect(mockAkbReorderBacklogIssues).not.toHaveBeenCalled();
  });

  it("applies the assignments atomically and returns ok", async () => {
    mockAkbReorderBacklogIssues.mockResolvedValueOnce(undefined);
    const assignments = [
      { id: "REEF-1", rank: 1000 },
      { id: "REEF-2", rank: 2000 },
    ];

    const res = await POST(reorderRequest({ vault: "reef-acme", assignments }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockAkbReorderBacklogIssues).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        assignments,
        actor: "carol",
      }),
    );
  });
});
