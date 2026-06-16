import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AkbAdapter } from "../adapters/akb";
import { ActivitySuggestionError } from "../errors";
import { approveActivitySuggestion } from "./approveActivitySuggestion";

const {
  mockAllocateNextIssueId,
  mockEnsureReefTables,
  mockListIssues,
  mockReadActivitySuggestion,
  mockReadIssue,
  mockUpdateActivitySuggestionStatus,
  mockUpdateIssue,
  mockWriteIssue,
} = vi.hoisted(() => ({
  mockAllocateNextIssueId: vi.fn(),
  mockEnsureReefTables: vi.fn(),
  mockListIssues: vi.fn(),
  mockReadActivitySuggestion: vi.fn(),
  mockReadIssue: vi.fn(),
  mockUpdateActivitySuggestionStatus: vi.fn(),
  mockUpdateIssue: vi.fn(),
  mockWriteIssue: vi.fn(),
}));

vi.mock("../adapters/akb", async (importOriginal) => {
  const original = await importOriginal<typeof import("../adapters/akb")>();
  return {
    ...original,
    // buildIssueMetadataFromCreateInput stays real (pure metadata builder).
    allocateNextIssueId: mockAllocateNextIssueId,
    ensureReefTables: mockEnsureReefTables,
    listIssues: mockListIssues,
    readActivitySuggestion: mockReadActivitySuggestion,
    readIssue: mockReadIssue,
    updateActivitySuggestionStatus: mockUpdateActivitySuggestionStatus,
    updateIssue: mockUpdateIssue,
    writeIssue: mockWriteIssue,
  };
});

const adapter = { request: vi.fn() } as unknown as AkbAdapter;
const DRAFT_ID = "reef-draft-0123456789abcdef";

describe("approveActivitySuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureReefTables.mockResolvedValue(undefined);
    mockListIssues.mockResolvedValue({ issues: [] });
    mockAllocateNextIssueId.mockResolvedValue("REEF-123");
    mockWriteIssue.mockResolvedValue({
      path: "_reef/issues/reef-123.md",
      commit_hash: "abc",
    });
    mockUpdateIssue.mockResolvedValue({
      path: "_reef/issues/reef-123.md",
      commit_hash: "statusabc",
    });
    // Default: issue is in_review, so an in_review -> done status change is a
    // legal forward transition at approval time.
    mockReadIssue.mockResolvedValue({ issue: { status: "in_review" } });
    mockUpdateActivitySuggestionStatus.mockResolvedValue({
      suggestion: {
        id: DRAFT_ID,
        kind: "draft",
        status: "approved",
        fingerprint: "octo/cat:commit:abc123",
        repo: "octo/cat",
        created_at: "2026-05-01T00:00:00.000Z",
        detected_at: "2026-05-01T00:00:00.000Z",
        proposal: {
          operation: "create",
          create: { fields: { title: "Draft" }, content: "Body" },
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
  });

  it("copies planning fields from an approved AI draft into the created issue", async () => {
    mockReadActivitySuggestion.mockResolvedValueOnce({
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
              issue_type: "task",
              sprint_id: "11111111-1111-4111-8111-111111111111",
              milestone_id: "22222222-2222-4222-8222-222222222222",
              release_id: "33333333-3333-4333-8333-333333333333",
              blocks: ["REEF-099"],
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

    const result = await approveActivitySuggestion({
      adapter,
      vault: "reef-acme",
      id: DRAFT_ID,
      actor: "carol",
      prefix: "REEF",
    });

    expect(result.issueId).toBe("REEF-123");
    expect(mockWriteIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        issue: expect.objectContaining({
          id: "REEF-123",
          created_by: "carol",
          updated_by: "carol",
          sprint_id: "11111111-1111-4111-8111-111111111111",
          milestone_id: "22222222-2222-4222-8222-222222222222",
          release_id: "33333333-3333-4333-8333-333333333333",
          blocks: ["REEF-099"],
        }),
        content: "Body",
      }),
    );
  });

  it("recovers a code-signal status for a status-less draft on approval (REEF-130 old-shape)", async () => {
    // A draft captured before REEF-130 carries no status. Approving it should not
    // drop in-flight work into `backlog`; a commit provenance recovers
    // `in_progress`.
    mockReadActivitySuggestion.mockResolvedValueOnce({
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
          create: { fields: { title: "Draft" }, content: "Body" },
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

    await approveActivitySuggestion({
      adapter,
      vault: "reef-acme",
      id: DRAFT_ID,
      actor: "carol",
      prefix: "REEF",
    });

    expect(mockWriteIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.objectContaining({ status: "in_progress" }),
      }),
    );
  });

  it("recovers in_review for a status-less draft from a PR provenance", async () => {
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: DRAFT_ID,
        kind: "draft",
        status: "pending",
        fingerprint: "octo/cat:pr:7",
        repo: "octo/cat",
        created_at: "2026-05-01T00:00:00.000Z",
        detected_at: "2026-05-01T00:00:00.000Z",
        proposal: {
          operation: "create",
          create: { fields: { title: "Draft" }, content: "Body" },
        },
        provenance: {
          type: "pr",
          ref: "7",
          repo: "octo/cat",
          actor: "alice",
          detectedAt: "2026-05-01T00:00:00.000Z",
        },
        confidence: 0.8,
        reasoning: "Open PR.",
      },
    });

    await approveActivitySuggestion({
      adapter,
      vault: "reef-acme",
      id: DRAFT_ID,
      actor: "carol",
      prefix: "REEF",
    });

    expect(mockWriteIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.objectContaining({ status: "in_review" }),
      }),
    );
  });

  it("honors an explicit draft status over provenance recovery", async () => {
    // Drafts generated after REEF-130 carry a precise scan-time status (e.g.
    // `done` from a merged PR); approval should not override it with the coarser
    // provenance recovery.
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: DRAFT_ID,
        kind: "draft",
        status: "pending",
        fingerprint: "octo/cat:pr:7",
        repo: "octo/cat",
        created_at: "2026-05-01T00:00:00.000Z",
        detected_at: "2026-05-01T00:00:00.000Z",
        proposal: {
          operation: "create",
          create: {
            fields: { title: "Draft", status: "done" },
            content: "Body",
          },
        },
        provenance: {
          type: "pr",
          ref: "7",
          repo: "octo/cat",
          actor: "alice",
          detectedAt: "2026-05-01T00:00:00.000Z",
        },
        confidence: 0.8,
        reasoning: "Merged PR.",
      },
    });

    await approveActivitySuggestion({
      adapter,
      vault: "reef-acme",
      id: DRAFT_ID,
      actor: "carol",
      prefix: "REEF",
    });

    expect(mockWriteIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.objectContaining({ status: "done" }),
      }),
    );
  });

  it("finalizes draft approval when a pre-migration source already created the issue", async () => {
    mockReadActivitySuggestion.mockResolvedValueOnce({
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
          create: { fields: { title: "Draft" }, content: "Body" },
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
    mockListIssues.mockResolvedValueOnce({
      issues: [{ id: "REEF-077", source: `ai-agent:draft_issue:${DRAFT_ID}` }],
    });

    const result = await approveActivitySuggestion({
      adapter,
      vault: "reef-acme",
      id: DRAFT_ID,
      actor: "carol",
      prefix: "REEF",
    });

    expect(result).toEqual(expect.objectContaining({ issueId: "REEF-077" }));
    expect(mockAllocateNextIssueId).not.toHaveBeenCalled();
    expect(mockWriteIssue).not.toHaveBeenCalled();
    expect(mockUpdateActivitySuggestionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        id: DRAFT_ID,
        status: "approved",
        approved_issue_id: "REEF-077",
      }),
    );
  });

  it("updates issue status (and stamps updated_by) when approving a status change", async () => {
    const statusChangeId = "reef-status-0123456789abcdef";
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: statusChangeId,
        kind: "status_change",
        status: "pending",
        fingerprint: "REEF-123|done|octo/cat:pr:42",
        repo: "octo/cat",
        created_at: "2026-05-01T00:00:00.000Z",
        detected_at: "2026-05-01T00:00:00.000Z",
        proposal: {
          operation: "update",
          update: { issue_id: "REEF-123", patch: { status: "done" } },
        },
        issue_title: "Existing issue",
        from_status: "in_review",
        rationale: "The implementing PR was merged.",
        evidence: [{ type: "pr", ref: "42", repo: "octo/cat", actor: "alice" }],
        confidence: 0.9,
      },
    });

    const result = await approveActivitySuggestion({
      adapter,
      vault: "reef-acme",
      id: statusChangeId,
      actor: "carol",
    });

    expect(result.issueId).toBe("REEF-123");
    expect(mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        id: "REEF-123",
        partial: expect.objectContaining({
          status: "done",
          source: `ai-agent:status_change:${statusChangeId}`,
          updated_by: "carol",
        }),
      }),
    );
    // The rationale should not be written to the issue.
    const updateCall = mockUpdateIssue.mock.calls[0]?.[0] as {
      partial: Record<string, unknown>;
      content?: unknown;
    };
    expect(updateCall.partial).not.toHaveProperty("rationale");
    expect(updateCall.content).toBeUndefined();
    expect(updateCall.partial).toHaveProperty("last_status_change");
  });

  // REEF-138: a status_change approve should also record the suggestion's PR/commit
  // evidence as delivery refs on the target issue, the way the draft path fills
  // implementation_refs for brand-new issues.
  const statusChangeSuggestion = (
    evidence: Array<{
      type: "pr" | "commit";
      ref: string;
      repo: string;
      actor: string;
    }>,
  ) => ({
    id: "reef-status-0123456789abcdef",
    kind: "status_change" as const,
    status: "pending" as const,
    fingerprint: "REEF-123|done|octo/cat:pr:42",
    repo: "octo/cat",
    created_at: "2026-05-01T00:00:00.000Z",
    detected_at: "2026-05-01T00:00:00.000Z",
    proposal: {
      operation: "update" as const,
      update: { issue_id: "REEF-123", patch: { status: "done" } },
    },
    issue_title: "Existing issue",
    from_status: "in_review" as const,
    rationale: "The implementing PR was merged.",
    evidence,
    confidence: 0.9,
  });

  const partialOfFirstUpdate = () =>
    (
      mockUpdateIssue.mock.calls[0]?.[0] as {
        partial: { implementation_refs?: unknown };
      }
    ).partial;

  it("records PR evidence as a pull_request delivery ref when approving a status change", async () => {
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: statusChangeSuggestion([
        { type: "pr", ref: "42", repo: "octo/cat", actor: "alice" },
      ]),
    });

    await approveActivitySuggestion({
      adapter,
      vault: "reef-acme",
      id: "reef-status-0123456789abcdef",
      actor: "carol",
    });

    expect(partialOfFirstUpdate().implementation_refs).toEqual([
      {
        type: "pull_request",
        repo: "octo/cat",
        ref: "42",
        actor: "alice",
        detected_at: "2026-05-01T00:00:00.000Z",
        url: "https://github.com/octo/cat/pull/42",
      },
    ]);
  });

  it("records commit-only evidence as a commit delivery ref", async () => {
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: statusChangeSuggestion([
        { type: "commit", ref: "abc123", repo: "octo/cat", actor: "bob" },
      ]),
    });

    await approveActivitySuggestion({
      adapter,
      vault: "reef-acme",
      id: "reef-status-0123456789abcdef",
      actor: "carol",
    });

    expect(partialOfFirstUpdate().implementation_refs).toEqual([
      {
        type: "commit",
        repo: "octo/cat",
        ref: "abc123",
        actor: "bob",
        detected_at: "2026-05-01T00:00:00.000Z",
        url: "https://github.com/octo/cat/commit/abc123",
      },
    ]);
  });

  it("de-duplicates delivery refs against the issue's existing implementation_refs", async () => {
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: statusChangeSuggestion([
        { type: "pr", ref: "42", repo: "octo/cat", actor: "alice" },
      ]),
    });
    // The issue already carries the same PR ref (an earlier approval / re-scan).
    mockReadIssue.mockResolvedValueOnce({
      issue: {
        status: "in_review",
        implementation_refs: [
          {
            type: "pull_request",
            repo: "octo/cat",
            ref: "42",
            actor: "alice",
            detected_at: "2026-05-01T00:00:00.000Z",
            url: "https://github.com/octo/cat/pull/42",
          },
        ],
      },
    });

    await approveActivitySuggestion({
      adapter,
      vault: "reef-acme",
      id: "reef-status-0123456789abcdef",
      actor: "carol",
    });

    expect(partialOfFirstUpdate().implementation_refs).toHaveLength(1);
  });

  it("preserves unrelated existing implementation_refs while recording new evidence", async () => {
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: statusChangeSuggestion([
        { type: "pr", ref: "42", repo: "octo/cat", actor: "alice" },
      ]),
    });
    const unrelated = {
      type: "commit",
      repo: "octo/cat",
      ref: "feedface",
      actor: "carol",
    };
    mockReadIssue.mockResolvedValueOnce({
      issue: { status: "in_review", implementation_refs: [unrelated] },
    });

    await approveActivitySuggestion({
      adapter,
      vault: "reef-acme",
      id: "reef-status-0123456789abcdef",
      actor: "carol",
    });

    const refs = partialOfFirstUpdate().implementation_refs as unknown[];
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual(unrelated);
    expect(refs[1]).toMatchObject({ type: "pull_request", ref: "42" });
  });

  it("ignores hidden non-status fields in stored status-change proposals", async () => {
    const statusChangeId = "reef-status-feedfacecafebeef";
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: statusChangeId,
        kind: "status_change",
        status: "pending",
        fingerprint: "REEF-123|done|octo/cat:pr:42",
        repo: "octo/cat",
        created_at: "2026-05-01T00:00:00.000Z",
        detected_at: "2026-05-01T00:00:00.000Z",
        proposal: {
          operation: "update",
          update: {
            issue_id: "REEF-123",
            patch: {
              status: "done",
              title: "Hidden title edit",
              assigned_to: "mallory",
              custom_fields: { hidden: true },
            },
          },
        },
        issue_title: "Existing issue",
        from_status: "in_review",
        rationale: "The implementing PR was merged.",
        evidence: [{ type: "pr", ref: "42", repo: "octo/cat", actor: "alice" }],
        confidence: 0.9,
      },
    });

    await approveActivitySuggestion({
      adapter,
      vault: "reef-acme",
      id: statusChangeId,
      actor: "carol",
    });

    const updateCall = mockUpdateIssue.mock.calls[0]?.[0] as {
      partial: Record<string, unknown>;
    };
    expect(updateCall.partial.status).toBe("done");
    expect(updateCall.partial).not.toHaveProperty("title");
    expect(updateCall.partial).not.toHaveProperty("assigned_to");
    expect(updateCall.partial).not.toHaveProperty("custom_fields");
  });

  it("rejects approving a status change that targets 'closed' (reason required elsewhere)", async () => {
    const statusChangeId = "reef-status-00000000deadbeef";
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: statusChangeId,
        kind: "status_change",
        status: "pending",
        fingerprint: "REEF-123|closed|octo/cat:pr:42",
        repo: "octo/cat",
        created_at: "2026-05-01T00:00:00.000Z",
        detected_at: "2026-05-01T00:00:00.000Z",
        proposal: {
          operation: "update",
          update: { issue_id: "REEF-123", patch: { status: "closed" } },
        },
        issue_title: "Existing issue",
        from_status: "in_review",
        rationale: "Looks abandoned.",
        evidence: [{ type: "pr", ref: "42", repo: "octo/cat", actor: "alice" }],
        confidence: 0.9,
      },
    });

    await expect(
      approveActivitySuggestion({
        adapter,
        vault: "reef-acme",
        id: statusChangeId,
        actor: "carol",
      }),
    ).rejects.toMatchObject({
      name: "ActivitySuggestionError",
      reason: "closed_target",
      httpStatus: 400,
    });
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  it("rejects a stale status change when the issue's current status no longer allows the transition", async () => {
    const statusChangeId = "reef-status-1111222233334444";
    // Suggestion was detected as open -> in_progress, but the issue has since
    // moved to done. isForwardStatus(done, in_progress) is false -> stale, no write.
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: statusChangeId,
        kind: "status_change",
        status: "pending",
        fingerprint: "REEF-123|in_progress|octo/cat:commit:abc123",
        repo: "octo/cat",
        created_at: "2026-05-01T00:00:00.000Z",
        detected_at: "2026-05-01T00:00:00.000Z",
        proposal: {
          operation: "update",
          update: { issue_id: "REEF-123", patch: { status: "in_progress" } },
        },
        issue_title: "Existing issue",
        from_status: "todo",
        rationale: "Work started.",
        evidence: [
          { type: "commit", ref: "abc123", repo: "octo/cat", actor: "alice" },
        ],
        confidence: 0.6,
      },
    });
    mockReadIssue.mockResolvedValueOnce({ issue: { status: "done" } });

    await expect(
      approveActivitySuggestion({
        adapter,
        vault: "reef-acme",
        id: statusChangeId,
        actor: "carol",
      }),
    ).rejects.toMatchObject({
      name: "ActivitySuggestionError",
      reason: "stale",
      httpStatus: 409,
    });
    expect(mockUpdateIssue).not.toHaveBeenCalled();
    expect(mockUpdateActivitySuggestionStatus).not.toHaveBeenCalled();
  });

  it("idempotently finalizes a status change already applied by a prior partial write", async () => {
    const statusChangeId = "reef-status-aaaabbbbccccdddd";
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: statusChangeId,
        kind: "status_change",
        status: "pending",
        fingerprint: "REEF-123|done|octo/cat:pr:42",
        repo: "octo/cat",
        created_at: "2026-05-01T00:00:00.000Z",
        detected_at: "2026-05-01T00:00:00.000Z",
        proposal: {
          operation: "update",
          update: { issue_id: "REEF-123", patch: { status: "done" } },
        },
        issue_title: "Existing issue",
        from_status: "in_review",
        rationale: "The PR was merged.",
        evidence: [{ type: "pr", ref: "42", repo: "octo/cat", actor: "alice" }],
        confidence: 0.9,
      },
    });
    // The issue is already at "done" and stamped with THIS suggestion's source
    // — i.e. the prior approval's issue write succeeded but the suggestion
    // status update failed. Retry should finalize, not 409 or re-write.
    mockReadIssue.mockResolvedValueOnce({
      issue: {
        status: "done",
        source: `ai-agent:status_change:${statusChangeId}`,
      },
    });

    const result = await approveActivitySuggestion({
      adapter,
      vault: "reef-acme",
      id: statusChangeId,
      actor: "carol",
    });

    expect(result.issueId).toBe("REEF-123");
    expect(mockUpdateIssue).not.toHaveBeenCalled();
    expect(mockUpdateActivitySuggestionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: statusChangeId, status: "approved" }),
    );
  });
});
