// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const {
  mockAkbEnsureReefTables,
  mockAkbReadActivitySuggestion,
  mockAkbUpdateActivitySuggestion,
  mockGetAkbAdapter,
} = vi.hoisted(() => ({
  mockAkbEnsureReefTables: vi.fn(),
  mockAkbReadActivitySuggestion: vi.fn(),
  mockAkbUpdateActivitySuggestion: vi.fn(),
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
    akbUpdateActivitySuggestion: mockAkbUpdateActivitySuggestion,
  };
});

import { PATCH } from "./route";

const DRAFT_ID = "reef-draft-0123456789abcdef";
const STATUS_ID = "reef-status-0123456789abcdef";

function patchRequest(body: unknown, id = DRAFT_ID): Request {
  return new Request(`http://localhost/api/activity/suggestions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/activity/suggestions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAkbAdapter.mockReturnValue({ adapter: { request: vi.fn() } });
    mockAkbEnsureReefTables.mockResolvedValue(undefined);
    mockAkbReadActivitySuggestion.mockResolvedValue({
      suggestion: {
        id: DRAFT_ID,
        kind: "draft",
        status: "pending",
      },
    });
  });

  it("accepts planning fields on draft suggestion edits", async () => {
    mockAkbUpdateActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: DRAFT_ID,
        kind: "draft",
        status: "pending",
        fingerprint: "octo/cat:commit:abc123",
        repo: "octo/cat",
        created_at: "2026-05-01T00:00:00.000Z",
        detected_at: "2026-05-01T00:00:00.000Z",
        proposal: {
          operation: "create",
          create: {
            fields: {
              title: "Draft",
              sprint_id: "11111111-1111-4111-8111-111111111111",
              milestone_id: "22222222-2222-4222-8222-222222222222",
            },
            content: "Body",
          },
        },
        provenance: {
          type: "commit",
          ref: "abc123",
          repo: "octo/cat",
          actor: "alice",
          detectedAt: "2026-05-01T00:00:00.000Z",
        },
        confidence: 0.8,
        reasoning: "Meaningful work.",
      },
    });

    const res = await PATCH(
      patchRequest({
        vault: "reef-acme",
        create: {
          fields: {
            title: "Draft",
            sprint_id: "11111111-1111-4111-8111-111111111111",
            milestone_id: "22222222-2222-4222-8222-222222222222",
            release_id: null,
          },
          content: "Body",
        },
      }),
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );

    expect(res.status).toBe(200);
    expect(mockAkbUpdateActivitySuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        id: DRAFT_ID,
        patch: expect.objectContaining({
          create: expect.objectContaining({
            fields: expect.objectContaining({
              sprint_id: "11111111-1111-4111-8111-111111111111",
              milestone_id: "22222222-2222-4222-8222-222222222222",
              release_id: null,
            }),
            content: "Body",
          }),
        }),
      }),
    );
  });

  it("accepts status-change edits as a status-only update on the original issue", async () => {
    mockAkbReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: STATUS_ID,
        kind: "status_change",
        status: "pending",
        proposal: {
          operation: "update",
          update: {
            issue_id: "REEF-001",
            patch: { status: "in_review" },
          },
        },
      },
    });
    mockAkbUpdateActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: STATUS_ID,
        kind: "status_change",
        status: "pending",
      },
    });

    const res = await PATCH(
      patchRequest(
        {
          vault: "reef-acme",
          update: {
            issue_id: "REEF-001",
            patch: { status: "done" },
          },
          rationale: "The work has merged.",
        },
        STATUS_ID,
      ),
      { params: Promise.resolve({ id: STATUS_ID }) },
    );

    expect(res.status).toBe(200);
    expect(mockAkbUpdateActivitySuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        id: STATUS_ID,
        patch: {
          update: {
            issue_id: "REEF-001",
            patch: { status: "done" },
          },
          rationale: "The work has merged.",
        },
      }),
    );
  });

  it("accepts rationale-only edits on status-change suggestions", async () => {
    mockAkbReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: STATUS_ID,
        kind: "status_change",
        status: "pending",
        proposal: {
          operation: "update",
          update: {
            issue_id: "REEF-001",
            patch: { status: "in_review" },
          },
        },
      },
    });
    mockAkbUpdateActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: STATUS_ID,
        kind: "status_change",
        status: "pending",
      },
    });

    const res = await PATCH(
      patchRequest(
        {
          vault: "reef-acme",
          rationale: "Updated rationale.",
        },
        STATUS_ID,
      ),
      { params: Promise.resolve({ id: STATUS_ID }) },
    );

    expect(res.status).toBe(200);
    expect(mockAkbUpdateActivitySuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        id: STATUS_ID,
        patch: {
          update: {
            issue_id: "REEF-001",
            patch: { status: "in_review" },
          },
          rationale: "Updated rationale.",
        },
      }),
    );
  });

  it("rejects status-change edits that retarget another issue", async () => {
    mockAkbReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: STATUS_ID,
        kind: "status_change",
        status: "pending",
        proposal: {
          operation: "update",
          update: {
            issue_id: "REEF-001",
            patch: { status: "in_review" },
          },
        },
      },
    });

    const res = await PATCH(
      patchRequest(
        {
          vault: "reef-acme",
          update: {
            issue_id: "REEF-999",
            patch: { status: "done" },
          },
        },
        STATUS_ID,
      ),
      { params: Promise.resolve({ id: STATUS_ID }) },
    );

    expect(res.status).toBe(400);
    expect(mockAkbUpdateActivitySuggestion).not.toHaveBeenCalled();
  });

  it("rejects hidden metadata fields in status-change updates", async () => {
    mockAkbReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: STATUS_ID,
        kind: "status_change",
        status: "pending",
        proposal: {
          operation: "update",
          update: {
            issue_id: "REEF-001",
            patch: { status: "in_review" },
          },
        },
      },
    });

    const res = await PATCH(
      patchRequest(
        {
          vault: "reef-acme",
          update: {
            issue_id: "REEF-001",
            patch: { status: "done", title: "Hidden edit" },
          },
        },
        STATUS_ID,
      ),
      { params: Promise.resolve({ id: STATUS_ID }) },
    );

    expect(res.status).toBe(400);
    expect(mockAkbUpdateActivitySuggestion).not.toHaveBeenCalled();
  });

  it("rejects closed as an activity status-change target", async () => {
    const res = await PATCH(
      patchRequest(
        {
          vault: "reef-acme",
          update: {
            issue_id: "REEF-001",
            patch: { status: "closed" },
          },
        },
        STATUS_ID,
      ),
      { params: Promise.resolve({ id: STATUS_ID }) },
    );

    expect(res.status).toBe(400);
    expect(mockAkbReadActivitySuggestion).not.toHaveBeenCalled();
    expect(mockAkbUpdateActivitySuggestion).not.toHaveBeenCalled();
  });

  it("rejects backlog as an activity status-change target (REEF-109)", async () => {
    // `backlog` is rank 0; approval's forward-moving guard could does not accept it,
    // so a backlog target should be rejected at the edit boundary rather than
    // saved into an unapprovable suggestion.
    const res = await PATCH(
      patchRequest(
        {
          vault: "reef-acme",
          update: {
            issue_id: "REEF-001",
            patch: { status: "backlog" },
          },
        },
        STATUS_ID,
      ),
      { params: Promise.resolve({ id: STATUS_ID }) },
    );

    expect(res.status).toBe(400);
    expect(mockAkbReadActivitySuggestion).not.toHaveBeenCalled();
    expect(mockAkbUpdateActivitySuggestion).not.toHaveBeenCalled();
  });
});
