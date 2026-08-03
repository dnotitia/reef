// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const {
  mockAkbEnsureReefTables,
  mockAkbReadActivitySuggestion,
  mockAkbUpdateActivitySuggestionStatus,
  mockGetAkbAdapter,
} = vi.hoisted(() => ({
  mockAkbEnsureReefTables: vi.fn(),
  mockAkbReadActivitySuggestion: vi.fn(),
  mockAkbUpdateActivitySuggestionStatus: vi.fn(),
  mockGetAkbAdapter: vi.fn(),
}));

vi.mock("@/lib/api/requestHelpers", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api/requestHelpers")>();
  return {
    ...original,
    getAkbAdapter: mockGetAkbAdapter,
  };
});

vi.mock("@reef/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@reef/core")>();
  return {
    ...original,
    akbEnsureReefTables: mockAkbEnsureReefTables,
    akbReadActivitySuggestion: mockAkbReadActivitySuggestion,
    akbUpdateActivitySuggestionStatus: mockAkbUpdateActivitySuggestionStatus,
  };
});

import { POST } from "./route";

const SUGGESTION_ID = "reef-status-0123456789abcdef";

function dismissRequest(body: unknown, id = SUGGESTION_ID): Request {
  return new Request(
    `http://localhost/api/activity/suggestions/${id}/dismiss`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/activity/suggestions/[id]/dismiss", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAkbAdapter.mockReturnValue({ adapter: { request: vi.fn() } });
    mockAkbEnsureReefTables.mockResolvedValue(undefined);
    mockAkbReadActivitySuggestion.mockResolvedValue({
      suggestion: { id: SUGGESTION_ID, status: "pending" },
    });
    mockAkbUpdateActivitySuggestionStatus.mockResolvedValue({
      suggestion: { id: SUGGESTION_ID, status: "dismissed" },
    });
  });

  it("dismisses a pending suggestion", async () => {
    const response = await POST(dismissRequest({ vault: "reef-acme" }), {
      params: Promise.resolve({ id: SUGGESTION_ID }),
    });

    expect(response.status).toBe(200);
    expect(mockAkbUpdateActivitySuggestionStatus).toHaveBeenCalledWith({
      adapter: expect.anything(),
      vault: "reef-acme",
      id: SUGGESTION_ID,
      status: "dismissed",
    });
  });

  it("rejects a suggestion that is no longer pending", async () => {
    mockAkbReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: { id: SUGGESTION_ID, status: "approved" },
    });

    const response = await POST(dismissRequest({ vault: "reef-acme" }), {
      params: Promise.resolve({ id: SUGGESTION_ID }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This suggestion has already been reviewed.",
    });
    expect(mockAkbUpdateActivitySuggestionStatus).not.toHaveBeenCalled();
  });
});
