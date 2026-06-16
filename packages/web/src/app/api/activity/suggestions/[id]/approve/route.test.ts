// @vitest-environment node
import { ActivitySuggestionError } from "@reef/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const {
  mockApproveActivitySuggestion,
  mockGetAkbAdapter,
  mockGetAkbCurrentActor,
} = vi.hoisted(() => ({
  mockApproveActivitySuggestion: vi.fn(),
  mockGetAkbAdapter: vi.fn(),
  mockGetAkbCurrentActor: vi.fn(),
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
    // ActivitySuggestionError stays the real class so core translateError's
    // instanceof check matches what this test throws.
    approveActivitySuggestion: mockApproveActivitySuggestion,
  };
});

import { POST } from "./route";

const DRAFT_ID = "reef-draft-0123456789abcdef";

function approveRequest(body: unknown, id = DRAFT_ID): Request {
  return new Request(
    `http://localhost/api/activity/suggestions/${id}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

// The approval state machine itself is unit-tested in core
// (approveActivitySuggestion.test.ts). These cover the thin handler's job:
// parse → delegate → translate.
describe("POST /api/activity/suggestions/[id]/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAkbAdapter.mockReturnValue({ adapter: { request: vi.fn() } });
    mockGetAkbCurrentActor.mockResolvedValue({ actor: "carol" });
  });

  it("delegates to the core orchestrator and returns its result as 200", async () => {
    mockApproveActivitySuggestion.mockResolvedValueOnce({
      suggestion: { id: DRAFT_ID },
      issueId: "REEF-123",
    });

    const res = await POST(
      approveRequest({ vault: "reef-acme", prefix: "REEF" }),
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestion: { id: DRAFT_ID },
      issueId: "REEF-123",
    });
    expect(mockApproveActivitySuggestion).toHaveBeenCalledWith({
      adapter: expect.anything(),
      vault: "reef-acme",
      id: DRAFT_ID,
      actor: "carol",
      prefix: "REEF",
    });
  });

  it("translates an ActivitySuggestionError to its HTTP status and message", async () => {
    mockApproveActivitySuggestion.mockRejectedValueOnce(
      new ActivitySuggestionError("stale"),
    );

    const res = await POST(approveRequest({ vault: "reef-acme" }), {
      params: Promise.resolve({ id: DRAFT_ID }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error:
        "This suggestion is out of date — the issue's status has already changed. Dismiss it and rescan.",
    });
  });

  it("rejects an invalid suggestion id before delegating", async () => {
    const res = await POST(
      approveRequest({ vault: "reef-acme" }, "not-valid"),
      {
        params: Promise.resolve({ id: "not-valid" }),
      },
    );

    expect(res.status).toBe(400);
    expect(mockApproveActivitySuggestion).not.toHaveBeenCalled();
  });
});
