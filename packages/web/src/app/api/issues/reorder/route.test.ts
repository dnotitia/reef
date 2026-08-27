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

const { mockAkbReorderIssue, mockCreateAkbAdapter } = vi.hoisted(() => ({
  mockAkbReorderIssue: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbReorderIssue: mockAkbReorderIssue,
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

const VALID_REORDER_BODY = {
  vault: "reef-acme",
  scope: "backlog",
  issue_id: "REEF-1",
  before_id: null,
  after_id: "REEF-2",
  expected: {
    issue_rank: 2000,
    issue_updated_at: "2026-05-01T00:00:00.000Z",
    before_rank: null,
    before_updated_at: null,
    after_rank: 3000,
    after_updated_at: "2026-05-01T00:00:00.000Z",
  },
};

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
      reorderRequest(VALID_REORDER_BODY, {
        "content-type": "application/json",
      }),
    );
    expect(res.status).toBe(401);
    expect(mockAkbReorderIssue).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body without a reorder target", async () => {
    const res = await POST(
      reorderRequest({ vault: "reef-acme", scope: "backlog" }),
    );
    expect(res.status).toBe(400);
    expect(mockAkbReorderIssue).not.toHaveBeenCalled();
  });

  it("returns the server-produced rank assignments", async () => {
    mockAkbReorderIssue.mockResolvedValueOnce({
      assignments: [{ id: "REEF-1", rank: 1000 }],
    });
    const res = await POST(reorderRequest(VALID_REORDER_BODY));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      assignments: [{ id: "REEF-1", rank: 1000 }],
    });
    expect(mockAkbReorderIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        scope: "backlog",
        issueId: "REEF-1",
        beforeId: null,
        afterId: "REEF-2",
        actor: "carol",
      }),
    );
  });
});
