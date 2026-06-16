// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

import { apiFetch } from "@/lib/apiClient";
import { type ApproveDraftInput, approveDraft } from "./approveDraft.actions";

const mockApiFetch = vi.mocked(apiFetch);

const DRAFT: ApproveDraftInput = {
  create: { fields: { title: "New" }, content: "## body" },
};

describe("approveDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs vault + prefix + create input to /api/drafts/approve", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issueId: "REEF-042" }), { status: 201 }),
    );

    const result = await approveDraft(DRAFT, "reef-acme", "REEF");

    expect(result).toEqual({ issueId: "REEF-042" });
    const [url, init] = mockApiFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/drafts/approve");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      vault: "reef-acme",
      prefix: "REEF",
      create: { fields: { title: "New" }, content: "## body" },
    });
  });

  it("throws an HttpError carrying the status when /api/drafts/approve fails", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Your session has expired." }), {
        status: 401,
      }),
    );

    await expect(
      approveDraft(DRAFT, "reef-acme", "REEF"),
    ).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining("session has expired"),
    });
  });

  it("falls back to the fallback message on a non-JSON error body", async () => {
    mockApiFetch.mockResolvedValue(new Response("oops", { status: 500 }));

    await expect(
      approveDraft(DRAFT, "reef-acme", "REEF"),
    ).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining("Failed to commit draft"),
    });
  });
});
