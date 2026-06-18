// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/telemetry", () => ({
  tracer: {
    startActiveSpan: vi.fn(
      async (
        _name: string,
        fn: (span: {
          setAttribute: () => void;
          recordException: () => void;
          setStatus: () => void;
          end: () => void;
        }) => Promise<unknown>,
      ) =>
        fn({
          setAttribute: () => {},
          recordException: () => {},
          setStatus: () => {},
          end: () => {},
        }),
    ),
  },
}));

const { mockListActivity, mockCreateAdapter } = vi.hoisted(() => ({
  mockListActivity: vi.fn(),
  mockCreateAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListIssueActivity: mockListActivity,
    createAkbAdapter: mockCreateAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../../__test-helpers__/jwt";
import { GET } from "./route";

const EVENT = {
  id: "11111111-1111-4111-8111-111111111111",
  reef_id: "REEF-001",
  event_type: "status_change",
  event_key: "status_change:todo->in_progress@2026-06-18T01:00:00.000Z",
  payload: { from: "todo", to: "in_progress" },
  actor: "alice",
  at: "2026-06-18T01:00:00.000Z",
  source: null,
};

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

function params(id = "REEF-001") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAdapter.mockReturnValue({ request: vi.fn() });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/issues/[id]/activity", () => {
  it("returns the issue's activity events", async () => {
    mockListActivity.mockResolvedValue([EVENT]);

    const res = await GET(
      new Request("http://localhost/api/issues/REEF-001/activity?vault=v", {
        headers: authedHeaders(),
      }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activity: [EVENT] });
    expect(mockListActivity).toHaveBeenCalledWith(
      expect.anything(),
      "v",
      "REEF-001",
    );
  });

  it("400s without a vault param", async () => {
    const res = await GET(
      new Request("http://localhost/api/issues/REEF-001/activity", {
        headers: authedHeaders(),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(mockListActivity).not.toHaveBeenCalled();
  });

  it("400s on a malformed issue id", async () => {
    const res = await GET(
      new Request("http://localhost/api/issues/nope/activity?vault=v", {
        headers: authedHeaders(),
      }),
      params("not an id"),
    );
    expect(res.status).toBe(400);
    expect(mockListActivity).not.toHaveBeenCalled();
  });
});
