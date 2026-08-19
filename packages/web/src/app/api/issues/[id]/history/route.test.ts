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

const { mockListHistory, mockCreateAdapter } = vi.hoisted(() => ({
  mockListHistory: vi.fn(),
  mockCreateAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListIssueBodyHistory: mockListHistory,
    createAkbAdapter: mockCreateAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../../__test-helpers__/jwt";
import { GET } from "./route";

const EVENT = {
  id: "body-update:c1",
  hash: "c1",
  at: "2026-08-18T01:00:00.000Z",
  actor: null,
  kind: "body_update",
};

function params(id = "REEF-127") {
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

describe("GET /api/issues/[id]/history", () => {
  it("returns projected body history", async () => {
    mockListHistory.mockResolvedValue([EVENT]);
    const res = await GET(
      new Request("http://localhost/api/issues/REEF-127/history?vault=v", {
        headers: { cookie: `${SESSION_COOKIE}=${VALID_JWT}` },
      }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ history: [EVENT] });
    expect(mockListHistory).toHaveBeenCalledWith(
      expect.anything(),
      "v",
      "REEF-127",
    );
  });

  it("validates the issue id and vault before calling core", async () => {
    const invalid = await GET(
      new Request("http://localhost/api/issues/nope/history?vault=v", {
        headers: { cookie: `${SESSION_COOKIE}=${VALID_JWT}` },
      }),
      params("not an id"),
    );
    expect(invalid.status).toBe(400);

    const missingVault = await GET(
      new Request("http://localhost/api/issues/REEF-127/history", {
        headers: { cookie: `${SESSION_COOKIE}=${VALID_JWT}` },
      }),
      params(),
    );
    expect(missingVault.status).toBe(400);
    expect(mockListHistory).not.toHaveBeenCalled();
  });
});
