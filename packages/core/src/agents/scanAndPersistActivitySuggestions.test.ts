import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnsureReefTables,
  mockListActivitySuggestions,
  mockReadAuthoringLanguage,
  mockReadConfig,
  mockScanActivity,
  mockWriteActivitySuggestion,
} = vi.hoisted(() => ({
  mockEnsureReefTables: vi.fn(),
  mockListActivitySuggestions: vi.fn(),
  mockReadAuthoringLanguage: vi.fn(),
  mockReadConfig: vi.fn(),
  mockScanActivity: vi.fn(),
  mockWriteActivitySuggestion: vi.fn(),
}));

vi.mock("../adapters", async (importOriginal) => {
  const original = await importOriginal<typeof import("../adapters")>();
  return {
    ...original,
    akbEnsureReefTables: mockEnsureReefTables,
    akbListActivitySuggestions: mockListActivitySuggestions,
    akbReadAuthoringLanguage: mockReadAuthoringLanguage,
    akbReadConfig: mockReadConfig,
    akbWriteActivitySuggestion: mockWriteActivitySuggestion,
  };
});

vi.mock("./scanActivity", () => ({
  scanActivity: mockScanActivity,
}));

import type { AkbAdapter, GitHubAdapter, LlmAdapter } from "../adapters";
import { SchemaValidationError } from "../errors";
import type { PendingDraft } from "../schemas/activity/pendingDraft";
import type { ActivitySuggestion } from "../schemas/activity/suggestion";
import { scanAndPersistActivitySuggestions } from "./scanAndPersistActivitySuggestions";

/**
 * Default config read result: `octo/cat` (the repo the existing tests scan) is
 * monitored and AI scanning is enabled, so the REEF-289 boundary check and the
 * REEF-313 kill switch both pass and the existing scan behavior is exercised.
 * Cases that test the boundary or the kill switch override these per-test.
 */
function monitoredConfig(
  repos: { owner: string; name: string }[] = [{ owner: "octo", name: "cat" }],
  aiScanningEnabled = true,
) {
  return {
    config: {
      project_prefix: "REEF",
      monitored_repos: repos.map((repo, index) => ({
        github_id: index + 1,
        owner: repo.owner,
        name: repo.name,
        description: null,
      })),
      authoring_language: null,
      stale_hide_completed_days: 14,
      stale_hide_canceled_days: 14,
      ai_scanning_enabled: aiScanningEnabled,
    },
    exists: true,
  };
}

const akbAdapter = { request: vi.fn() } as unknown as AkbAdapter;
const githubAdapter = {
  listAuthenticatedRepositories: vi.fn(),
  listInstallationRepositories: vi.fn(),
  listRecentActivity: vi.fn(),
  searchCode: vi.fn(),
  readFile: vi.fn(),
  listRepoLabels: vi.fn(),
} satisfies GitHubAdapter;
const llmAdapter = { model: vi.fn() } as unknown as LlmAdapter;

const draftFixture: PendingDraft = {
  id: "00000000-0000-0000-0000-000000000001",
  proposal: {
    operation: "create",
    create: {
      fields: {
        title: "Add login flow",
        issue_type: "story",
        priority: null,
        assigned_to: null,
        requester: null,
        reporter: null,
        start_date: null,
        due_date: null,
        milestone_id: null,
        sprint_id: null,
        release_id: null,
        estimate_points: null,
        severity: null,
        parent_id: null,
        labels: [],
        depends_on: [],
        blocks: [],
        related_to: [],
        external_refs: [],
      },
      content: "Implement the login flow.",
    },
  },
  provenance: {
    type: "commit",
    ref: "abc123",
    repo: "octo/cat",
    actor: "alice",
    detectedAt: "2026-05-08T10:00:00.000Z",
  },
  confidence: 0.8,
  reasoning: "Commit introduced login work.",
  status: "pending",
  createdAt: "2026-05-08T10:00:00.000Z",
};

const dismissedDraftSuggestion: ActivitySuggestion = {
  id: "reef-draft-0123456789abcdef",
  kind: "draft",
  status: "dismissed",
  fingerprint: "octo/cat:commit:old",
  repo: "octo/cat",
  created_at: "2026-05-08T09:00:00.000Z",
  detected_at: "2026-05-08T09:00:00.000Z",
  proposal: {
    operation: "create",
    create: {
      fields: { title: "Existing" },
      content: "Existing",
    },
  },
  provenance: {
    type: "commit",
    ref: "old",
    repo: "octo/cat",
    actor: "alice",
    detectedAt: "2026-05-08T09:00:00.000Z",
  },
  confidence: 0.8,
  reasoning: "Existing suggestion.",
};

const dismissedStatusSuggestion: ActivitySuggestion = {
  id: "reef-status-0123456789abcdef",
  kind: "status_change",
  status: "dismissed",
  fingerprint: "REEF-001|done|octo/cat:pr:7",
  repo: "octo/cat",
  created_at: "2026-05-08T09:00:00.000Z",
  detected_at: "2026-05-08T09:00:00.000Z",
  proposal: {
    operation: "update",
    update: {
      issue_id: "REEF-001",
      patch: { status: "done" },
    },
  },
  issue_title: "Existing status",
  from_status: "in_review",
  rationale: "PR merged.",
  evidence: [
    {
      type: "pr",
      ref: "7",
      repo: "octo/cat",
      actor: "bob",
    },
  ],
  confidence: 0.9,
};

describe("scanAndPersistActivitySuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureReefTables.mockResolvedValue(undefined);
    mockListActivitySuggestions.mockResolvedValue({ suggestions: [] });
    mockReadAuthoringLanguage.mockResolvedValue(null);
    mockReadConfig.mockResolvedValue(monitoredConfig());
    mockScanActivity.mockResolvedValue({ drafts: [], statusChanges: [] });
    mockWriteActivitySuggestion.mockResolvedValue({
      path: "_reef/activity-inbox/reef-draft-test.md",
      commit_hash: "abc123",
    });
  });

  it("suppresses existing suggestion refs and persists generated suggestions", async () => {
    mockListActivitySuggestions.mockResolvedValueOnce({
      suggestions: [dismissedDraftSuggestion, dismissedStatusSuggestion],
    });
    mockReadAuthoringLanguage.mockResolvedValueOnce("ko");
    mockScanActivity.mockResolvedValueOnce({
      drafts: [draftFixture],
      statusChanges: [],
    });

    const result = await scanAndPersistActivitySuggestions({
      adapter: githubAdapter,
      akbAdapter,
      vault: "reef-test",
      llmAdapter,
      owner: "octo",
      repo: "cat",
      since: "2026-05-08T08:00:00.000Z",
      projectPrefix: "REEF",
    });

    expect(result.status).toBe("completed");
    expect(result.addedDrafts).toBe(1);
    expect(result.addedStatusChanges).toBe(0);
    expect(mockEnsureReefTables).toHaveBeenCalledWith({
      adapter: akbAdapter,
      vault: "reef-test",
    });
    expect(mockScanActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter: githubAdapter,
        akbAdapter,
        vault: "reef-test",
        owner: "octo",
        repo: "cat",
        since: "2026-05-08T08:00:00.000Z",
        projectPrefix: "REEF",
        authoringLanguage: "ko",
        dismissedRefs: expect.arrayContaining([
          "octo/cat:commit:old",
          "octo/cat:pr:7",
        ]),
      }),
    );
    expect(mockWriteActivitySuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter: akbAdapter,
        vault: "reef-test",
        suggestion: expect.objectContaining({
          kind: "draft",
          fingerprint: "octo/cat:commit:abc123",
        }),
      }),
    );
  });

  it("returns aborted without persisting scan results when the caller aborts", async () => {
    let aborted = false;
    mockScanActivity.mockImplementationOnce(async () => {
      aborted = true;
      return { drafts: [draftFixture], statusChanges: [] };
    });

    const result = await scanAndPersistActivitySuggestions({
      adapter: githubAdapter,
      akbAdapter,
      vault: "reef-test",
      llmAdapter,
      owner: "octo",
      repo: "cat",
      projectPrefix: "REEF",
      isAborted: () => aborted,
    });

    expect(result.status).toBe("aborted");
    expect(result.drafts).toHaveLength(1);
    expect(mockWriteActivitySuggestion).not.toHaveBeenCalled();
  });

  it("rejects a scan of a repo the vault does not monitor (REEF-289)", async () => {
    mockReadConfig.mockResolvedValueOnce(
      monitoredConfig([{ owner: "octo", name: "other-repo" }]),
    );

    await expect(
      scanAndPersistActivitySuggestions({
        adapter: githubAdapter,
        akbAdapter,
        vault: "reef-test",
        llmAdapter,
        owner: "octo",
        repo: "cat",
        projectPrefix: "REEF",
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);

    // No GitHub read and no akb write happen for an unmonitored repo.
    expect(mockScanActivity).not.toHaveBeenCalled();
    expect(mockEnsureReefTables).not.toHaveBeenCalled();
    expect(mockWriteActivitySuggestion).not.toHaveBeenCalled();
  });

  it("no-ops when the workspace AI-scanning switch is off, even for a monitored repo (REEF-313)", async () => {
    // octo/cat is monitored, but the kill switch is off: the scan exits before
    // any GitHub read, LLM call, or akb write.
    mockReadConfig.mockResolvedValueOnce(
      monitoredConfig([{ owner: "octo", name: "cat" }], false),
    );

    const result = await scanAndPersistActivitySuggestions({
      adapter: githubAdapter,
      akbAdapter,
      vault: "reef-test",
      llmAdapter,
      owner: "octo",
      repo: "cat",
      projectPrefix: "REEF",
    });

    expect(result.status).toBe("completed");
    expect(result.addedDrafts).toBe(0);
    expect(result.addedStatusChanges).toBe(0);
    expect(result.persistedSuggestions).toEqual([]);
    // No GitHub scan, no table provisioning, no akb write happen when disabled.
    expect(mockScanActivity).not.toHaveBeenCalled();
    expect(mockEnsureReefTables).not.toHaveBeenCalled();
    expect(mockListActivitySuggestions).not.toHaveBeenCalled();
    expect(mockWriteActivitySuggestion).not.toHaveBeenCalled();
  });

  it("no-ops (does not throw) when disabled and the repo is not monitored — the default state (REEF-313)", async () => {
    // The kill switch is checked BEFORE the monitored-repo boundary, so a
    // disabled workspace is a clean no-op even with no monitored repos (the
    // default-off, nothing-configured state) rather than a 422 unmonitored-repo
    // rejection. The boundary still fires when scanning is on (cases above).
    mockReadConfig.mockResolvedValueOnce(monitoredConfig([], false));

    const result = await scanAndPersistActivitySuggestions({
      adapter: githubAdapter,
      akbAdapter,
      vault: "reef-test",
      llmAdapter,
      owner: "octo",
      repo: "cat",
      projectPrefix: "REEF",
    });

    expect(result.status).toBe("completed");
    expect(result.addedDrafts).toBe(0);
    expect(mockScanActivity).not.toHaveBeenCalled();
    expect(mockEnsureReefTables).not.toHaveBeenCalled();
  });

  it("rejects when the vault monitors no repos", async () => {
    mockReadConfig.mockResolvedValueOnce(monitoredConfig([]));

    await expect(
      scanAndPersistActivitySuggestions({
        adapter: githubAdapter,
        akbAdapter,
        vault: "reef-test",
        llmAdapter,
        owner: "octo",
        repo: "cat",
        projectPrefix: "REEF",
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);

    expect(mockScanActivity).not.toHaveBeenCalled();
  });

  it("fails closed when the config read fails (does not scan unbounded)", async () => {
    mockReadConfig.mockRejectedValueOnce(new Error("akb backend unreachable"));

    await expect(
      scanAndPersistActivitySuggestions({
        adapter: githubAdapter,
        akbAdapter,
        vault: "reef-test",
        llmAdapter,
        owner: "octo",
        repo: "cat",
        projectPrefix: "REEF",
      }),
    ).rejects.toThrow("akb backend unreachable");

    expect(mockScanActivity).not.toHaveBeenCalled();
    expect(mockWriteActivitySuggestion).not.toHaveBeenCalled();
  });

  it("matches a monitored repo case-insensitively and proceeds (AC3)", async () => {
    mockReadConfig.mockResolvedValueOnce(
      monitoredConfig([{ owner: "octo", name: "cat" }]),
    );
    mockScanActivity.mockResolvedValueOnce({
      drafts: [draftFixture],
      statusChanges: [],
    });

    const result = await scanAndPersistActivitySuggestions({
      adapter: githubAdapter,
      akbAdapter,
      vault: "reef-test",
      llmAdapter,
      owner: "Octo",
      repo: "CAT",
      projectPrefix: "REEF",
    });

    expect(result.status).toBe("completed");
    expect(mockScanActivity).toHaveBeenCalledTimes(1);
  });
});
