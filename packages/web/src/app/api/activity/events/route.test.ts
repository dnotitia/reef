// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAkbEnsureReefTables, mockAkbListRecentActivity } = vi.hoisted(
  () => ({
    mockAkbEnsureReefTables: vi.fn(),
    mockAkbListRecentActivity: vi.fn(),
  }),
);

vi.mock("@reef/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@reef/core")>();
  return {
    ...original,
    akbEnsureReefTables: mockAkbEnsureReefTables,
    akbListRecentActivity: mockAkbListRecentActivity,
  };
});

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError } from "@reef/core";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { GET } from "./route";

const AUTH_COOKIE = `${SESSION_COOKIE}=${VALID_JWT}`;

const EVENT = {
  id: "11111111-1111-4111-8111-111111111111",
  reef_id: "REEF-208",
  event_type: "status_change",
  event_key: "status_change:todo->in_progress@2026-06-18T01:00:00.000Z",
  payload: { from: "todo", to: "in_progress" },
  actor: "alice",
  at: "2026-06-18T01:00:00.000Z",
  source: null,
  issue_title: "Backlog rank drag ordering",
};

function makeRequest(url: string): Request {
  return new Request(url, { headers: { cookie: AUTH_COOKIE } });
}

describe("GET /api/activity/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockAkbEnsureReefTables.mockResolvedValue(undefined);
    mockAkbListRecentActivity.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 400 when the vault param is missing", async () => {
    const res = await GET(makeRequest("http://localhost/api/activity/events"));
    expect(res.status).toBe(400);
    expect(mockAkbListRecentActivity).not.toHaveBeenCalled();
  });

  it("returns the events and forwards the since marker", async () => {
    mockAkbListRecentActivity.mockResolvedValueOnce([EVENT]);

    const res = await GET(
      makeRequest(
        "http://localhost/api/activity/events?vault=reef-acme&since=2026-06-18T00:00:00.000Z",
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [EVENT] });
    expect(mockAkbListRecentActivity).toHaveBeenCalledWith(
      expect.anything(),
      "reef-acme",
      { since: "2026-06-18T00:00:00.000Z" },
    );
  });

  it("omits the since option when no marker is provided", async () => {
    const res = await GET(
      makeRequest("http://localhost/api/activity/events?vault=reef-acme"),
    );

    expect(res.status).toBe(200);
    expect(mockAkbListRecentActivity).toHaveBeenCalledWith(
      expect.anything(),
      "reef-acme",
      {},
    );
  });

  it("translates an AuthError to 401", async () => {
    mockAkbListRecentActivity.mockRejectedValueOnce(new AuthError({}));

    const res = await GET(
      makeRequest("http://localhost/api/activity/events?vault=reef-acme"),
    );

    expect(res.status).toBe(401);
  });
});
