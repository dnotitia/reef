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

const { mockListChangeReview, mockCreateAdapter } = vi.hoisted(() => ({
  mockListChangeReview: vi.fn(),
  mockCreateAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListIssueChangeReview: mockListChangeReview,
    createAkbAdapter: mockCreateAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { GET } from "./route";

const REVIEW = {
  start_at: "2026-08-18T00:00:00.000Z",
  end_at: "2026-08-19T00:00:00.000Z",
  groups: [],
};

function request(path: string, authenticated = true): Request {
  return new Request(`http://localhost${path}`, {
    headers: authenticated
      ? { cookie: `${SESSION_COOKIE}=${VALID_JWT}` }
      : undefined,
  });
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAdapter.mockReturnValue({ request: vi.fn() });
  mockListChangeReview.mockResolvedValue(REVIEW);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/issues/changes", () => {
  it("validates the range and passes the normalized contract to core", async () => {
    const response = await GET(
      request(
        "/api/issues/changes?vault=reef-test&start_at=2026-08-18T00:00:00.000Z&end_at=2026-08-19T00:00:00.000Z",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(REVIEW);
    expect(mockListChangeReview).toHaveBeenCalledWith({
      adapter: expect.anything(),
      vault: "reef-test",
      range: {
        start_at: "2026-08-18T00:00:00.000Z",
        end_at: "2026-08-19T00:00:00.000Z",
      },
    });
  });

  it.each([
    "/api/issues/changes?vault=reef-test&start_at=2026-08-19T00:00:00.000Z&end_at=2026-08-18T00:00:00.000Z",
    "/api/issues/changes?vault=reef-test&start_at=not-a-date&end_at=2026-08-19T00:00:00.000Z",
    "/api/issues/changes?vault=reef-test&start_at=2026-08-18T00:00:00.000Z",
  ])(
    "returns 400 without reading core for an invalid range: %s",
    async (path) => {
      const response = await GET(request(path));

      expect(response.status).toBe(400);
      expect(mockListChangeReview).not.toHaveBeenCalled();
    },
  );

  it("preserves the shared vault and authentication boundaries", async () => {
    const missingVault = await GET(
      request(
        "/api/issues/changes?start_at=2026-08-18T00:00:00.000Z&end_at=2026-08-19T00:00:00.000Z",
      ),
    );
    expect(missingVault.status).toBe(400);

    const unauthenticated = await GET(
      request(
        "/api/issues/changes?vault=reef-test&start_at=2026-08-18T00:00:00.000Z&end_at=2026-08-19T00:00:00.000Z",
        false,
      ),
    );
    expect(unauthenticated.status).toBe(401);
    expect(mockListChangeReview).not.toHaveBeenCalled();
  });
});
