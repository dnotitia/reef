// @vitest-environment node
import { AuthError } from "@reef/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const {
  mockGetAkbAdapter,
  mockGetAkbCurrentActor,
  mockGetEffectiveSubscriptionState,
  mockMuteIssue,
  mockWatchIssue,
} = vi.hoisted(() => ({
  mockGetAkbAdapter: vi.fn(),
  mockGetAkbCurrentActor: vi.fn(),
  mockGetEffectiveSubscriptionState: vi.fn(),
  mockMuteIssue: vi.fn(),
  mockWatchIssue: vi.fn(),
}));

vi.mock("@/lib/api/requestHelpers", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api/requestHelpers")>();
  return {
    ...original,
    getAkbAdapter: mockGetAkbAdapter,
    getAkbCurrentActor: mockGetAkbCurrentActor,
  };
});

vi.mock("@reef/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@reef/core")>();
  return {
    ...original,
    akbGetEffectiveSubscriptionState: mockGetEffectiveSubscriptionState,
    akbMuteIssue: mockMuteIssue,
    akbWatchIssue: mockWatchIssue,
  };
});

import { GET, PUT } from "./route";

const adapter = { request: vi.fn() };
const params = { params: Promise.resolve({ id: "REEF-001" }) };

function request(
  method: "GET" | "PUT",
  body?: unknown,
  url = "http://localhost/api/issues/REEF-001/subscription?vault=reef-e2e",
) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/issues/[id]/subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAkbAdapter.mockReturnValue({ adapter });
    mockGetAkbCurrentActor.mockResolvedValue({ actor: "alice" });
    mockGetEffectiveSubscriptionState.mockResolvedValue("unwatched");
    mockWatchIssue.mockResolvedValue({});
    mockMuteIssue.mockResolvedValue({});
  });

  it("reads the effective state for the session actor", async () => {
    mockGetEffectiveSubscriptionState.mockResolvedValueOnce("watching");

    const response = await GET(request("GET"), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "watching" });
    expect(mockGetEffectiveSubscriptionState).toHaveBeenCalledWith(
      adapter,
      "reef-e2e",
      { reefId: "REEF-001", subscriber: "alice" },
    );
  });

  it.each([
    ["watch", mockWatchIssue, "watching"],
    ["mute", mockMuteIssue, "muted"],
  ] as const)(
    "%s writes only the session actor and returns the effective state",
    async (action, mutation, state) => {
      mockGetEffectiveSubscriptionState.mockResolvedValueOnce(state);

      const response = await PUT(request("PUT", { action }), params);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ state });
      expect(mutation).toHaveBeenCalledWith(adapter, "reef-e2e", {
        reefId: "REEF-001",
        subscriber: "alice",
      });
      expect(mockGetEffectiveSubscriptionState).toHaveBeenCalledWith(
        adapter,
        "reef-e2e",
        { reefId: "REEF-001", subscriber: "alice" },
      );
    },
  );

  it("rejects recipient override fields before resolving or mutating an actor", async () => {
    const response = await PUT(
      request("PUT", { action: "mute", subscriber: "bob" }),
      params,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Invalid request body.",
      details: {
        formErrors: ["Unrecognized key(s) in object: 'subscriber'"],
      },
    });
    expect(mockGetAkbCurrentActor).not.toHaveBeenCalled();
    expect(mockWatchIssue).not.toHaveBeenCalled();
    expect(mockMuteIssue).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await PUT(
      new Request(
        "http://localhost/api/issues/REEF-001/subscription?vault=reef-e2e",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "{not-json",
        },
      ),
      params,
    );

    expect(response.status).toBe(400);
    expect(mockWatchIssue).not.toHaveBeenCalled();
  });

  it("rejects malformed issue and vault identifiers", async () => {
    const badIssue = await GET(request("GET"), {
      params: Promise.resolve({ id: "not-an-issue" }),
    });
    const missingVault = await GET(
      request(
        "GET",
        undefined,
        "http://localhost/api/issues/REEF-001/subscription",
      ),
      params,
    );

    expect(badIssue.status).toBe(400);
    expect(missingVault.status).toBe(400);
    expect(mockGetEffectiveSubscriptionState).not.toHaveBeenCalled();
  });

  it("uses the existing PM-facing upstream error translation", async () => {
    mockGetEffectiveSubscriptionState.mockRejectedValueOnce(
      new AuthError({ origin: "akb", status: 401 }),
    );

    const response = await GET(request("GET"), params);

    expect(response.status).toBe(401);
    expect((await response.json()).error).toContain("sign in");
  });
});
