// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockRouteTelemetry } from "../../__test-helpers__/routeMocks";

mockRouteTelemetry();

const { mockListActivity, mockCreateAdapter } = vi.hoisted(() => ({
  mockListActivity: vi.fn(),
  mockCreateAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListReportActivity: mockListActivity,
    createAkbAdapter: mockCreateAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { GET } from "./route";

const EVENT = {
  id: "11111111-1111-4111-8111-111111111111",
  reef_id: "REEF-001",
  event_type: "status_change",
  event_key: "status_change:todo->done@2026-06-18T01:00:00.000Z",
  payload: { from: "todo", to: "done" },
  actor: "alice",
  at: "2026-06-18T01:00:00.000Z",
  source: null,
};

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAdapter.mockReturnValue({ request: vi.fn() });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/reports/activity", () => {
  it("returns bulk report activity for the requested vault", async () => {
    mockListActivity.mockResolvedValue([EVENT]);

    const response = await GET(
      new Request("http://localhost/api/reports/activity?vault=reef-acme", {
        headers: authedHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ activity: [EVENT] });
    expect(mockListActivity).toHaveBeenCalledWith(
      expect.anything(),
      "reef-acme",
    );
  });

  it("400s without a vault param", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/activity", {
        headers: authedHeaders(),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockListActivity).not.toHaveBeenCalled();
  });
});
