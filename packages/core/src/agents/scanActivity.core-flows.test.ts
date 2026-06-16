import { beforeEach, describe, expect, it } from "vitest";
import {
  VAULT,
  buildCommitsResponse,
  buildPrsResponse,
  makeGitHubAdapter,
  makeLlmAdapter,
  mockAkbAdapter,
  mockReadIssue,
  noIssueLinkJson,
  resetScanActivityMocks,
  scanActivity,
  validDraftJson,
} from "./scanActivity.testSupport";
import type { ScanActivityParams } from "./scanActivity.testSupport";

describe("scanActivity core flows", () => {
  beforeEach(() => {
    resetScanActivityMocks();
  });

  it("classifies untracked commits as drafts and tracked commits as status changes", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "untrackedSha", message: "feat: add rate limiting" },
        { oid: "trackedSha", message: "fix: resolve login bug (REEF-042)" },
      ]),
      buildPrsResponse(),
    );
    // Order: semantic linking for untracked, draft for still-untracked, then
    // status changes. A commit bucket maps to "in_progress", so the issue
    // should be "todo" for the forward transition to be allowed.
    const llm = makeLlmAdapter([
      { text: JSON.stringify(noIssueLinkJson) },
      { text: JSON.stringify(validDraftJson) },
      { text: JSON.stringify({ rationale: "Work has started on the fix." }) },
    ]);
    mockReadIssue.mockResolvedValueOnce({
      issue: { title: "Login bug", status: "todo" },
      content: "",
    });

    const { drafts, statusChanges } = await scanActivity({
      adapter,
      akbAdapter: mockAkbAdapter,
      vault: VAULT,
      llmAdapter: llm,
      owner: "acme",
      repo: "platform",
      since: "2026-04-06T00:00:00Z",
      projectPrefix: "REEF",
    });

    expect(drafts).toHaveLength(1);
    expect(statusChanges).toHaveLength(1);
    expect(drafts[0].provenance.ref).toBe("untrackedSha");
    expect(drafts[0].proposal.create.fields.start_date).toBe(
      "2026-04-07T10:00:00Z",
    );
    expect(
      drafts[0].proposal.create.fields.implementation_refs?.[0],
    ).toMatchObject({
      type: "commit",
      repo: "acme/platform",
      ref: "untrackedSha",
      url: "https://github.com/acme/platform/commit/untrackedSha",
      actor: "alicedev",
      title: "feat: add rate limiting",
    });
    expect(
      drafts[0].proposal.create.fields.implementation_refs?.[0]?.detected_at,
    ).toBeDefined();
    // A draft is born from a code signal — here a branch/commit with no PR — so
    // it lands at the inferred `in_progress` rather than the human `backlog`
    // default (REEF-130). The AI creation path follows code reality, not the
    // pre-commitment queue.
    expect(drafts[0].proposal.create.fields.status).toBe("in_progress");
    expect(statusChanges[0].proposal.update.issue_id).toBe("REEF-042");
    expect(statusChanges[0].issueTitle).toBe("Login bug");
    expect(statusChanges[0].fromStatus).toBe("todo");
    expect(statusChanges[0].proposal.update.patch.status).toBe("in_progress");
    expect(statusChanges[0].rationale).toBe("Work has started on the fix.");
  });

  it("emits typed task events and generated artifacts", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "untrackedSha", message: "feat: add rate limiting" },
        { oid: "trackedSha", message: "fix: resolve login bug (REEF-042)" },
      ]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify(noIssueLinkJson) },
      { text: JSON.stringify(validDraftJson) },
      { text: JSON.stringify({ rationale: "Work has started on the fix." }) },
    ]);
    mockReadIssue.mockResolvedValueOnce({
      issue: { title: "Login bug", status: "todo" },
      content: "",
    });
    const events: Parameters<NonNullable<ScanActivityParams["onEvent"]>>[0][] =
      [];

    await scanActivity({
      adapter,
      akbAdapter: mockAkbAdapter,
      vault: VAULT,
      llmAdapter: llm,
      owner: "acme",
      repo: "platform",
      since: "2026-04-06T00:00:00Z",
      projectPrefix: "REEF",
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(
      events
        .filter((event) => event.type === "run.started")
        .map((event) => event.task_id),
    ).toEqual(
      expect.arrayContaining([
        "activity.issue-link",
        "activity.draft",
        "activity.status-change",
      ]),
    );
    const artifacts = events.flatMap((event) =>
      event.type === "artifact.final" ? [event.artifact] : [],
    );
    expect(artifacts.map((artifact) => artifact.type).sort()).toEqual([
      "issue_create_proposal",
      "status_change_proposal",
    ]);
    expect(
      artifacts.find((artifact) => artifact.type === "issue_create_proposal")
        ?.payload.proposal.operation,
    ).toBe("create");
    expect(
      artifacts.find((artifact) => artifact.type === "status_change_proposal")
        ?.payload.to_status,
    ).toBe("in_progress");
  });

  it("keeps draft results when best-effort artifact validation fails", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "untrackedSha", message: "feat: add rate limiting" },
      ]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify(noIssueLinkJson) },
      { text: JSON.stringify({ ...validDraftJson, reasoning: "" }) },
    ]);
    const events: Parameters<NonNullable<ScanActivityParams["onEvent"]>>[0][] =
      [];

    const { drafts, statusChanges } = await scanActivity({
      adapter,
      akbAdapter: mockAkbAdapter,
      vault: VAULT,
      llmAdapter: llm,
      owner: "acme",
      repo: "platform",
      since: "2026-04-06T00:00:00Z",
      projectPrefix: "REEF",
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0].reasoning).toBe("");
    expect(statusChanges).toHaveLength(0);
    expect(
      events.some(
        (event) =>
          event.type === "artifact.final" &&
          event.artifact.type === "issue_create_proposal",
      ),
    ).toBe(false);
  });

  it("groups multiple commits referencing the same issue into one PendingStatusChange with N evidence", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        {
          oid: "shaA",
          message: "fix: REEF-001 part 1",
          actor: "alice",
        },
        {
          oid: "shaB",
          message: "fix: REEF-001 part 2",
          actor: "bob",
        },
      ]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify({ rationale: "Multi-commit fix in progress." }) },
    ]);
    mockReadIssue.mockResolvedValueOnce({
      issue: { title: "First issue", status: "todo" },
      content: "",
    });

    const { drafts, statusChanges } = await scanActivity({
      adapter,
      akbAdapter: mockAkbAdapter,
      vault: VAULT,
      llmAdapter: llm,
      owner: "acme",
      repo: "platform",
      since: "2026-04-06T00:00:00Z",
      projectPrefix: "REEF",
    });

    expect(drafts).toHaveLength(0);
    expect(statusChanges).toHaveLength(1);
    expect(statusChanges[0].evidence).toHaveLength(2);
    expect(statusChanges[0].evidence.map((e) => e.ref).sort()).toEqual([
      "shaA",
      "shaB",
    ]);
    expect(statusChanges[0].evidence.map((e) => e.actor).sort()).toEqual([
      "alice",
      "bob",
    ]);
    // readIssue should be called exactly once per issueId, not per commit.
    expect(mockReadIssue).toHaveBeenCalledTimes(1);
  });

  it("skips a status change when the referenced issue cannot be read", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([{ oid: "shaX", message: "fix: REEF-999 ghost" }]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([]);
    mockReadIssue.mockRejectedValueOnce(new Error("not found"));

    const { drafts, statusChanges } = await scanActivity({
      adapter,
      akbAdapter: mockAkbAdapter,
      vault: VAULT,
      llmAdapter: llm,
      owner: "acme",
      repo: "platform",
      since: "2026-04-06T00:00:00Z",
      projectPrefix: "REEF",
    });

    expect(drafts).toHaveLength(0);
    expect(statusChanges).toHaveLength(0);
    // LLM should not be invoked when the issue read failed.
    expect(llm.generateText).not.toHaveBeenCalled();
  });

  it("skips a status change when the transition is not allowed (no LLM call)", async () => {
    // A commit bucket maps to "in_progress"; an already-done issue does not
    // legally move there, so the suggestion is dropped before any LLM call.
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "shaDone", message: "fix: REEF-008 follow-up" },
      ]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([]);
    mockReadIssue.mockResolvedValueOnce({
      issue: { title: "Already done", status: "done" },
      content: "",
    });

    const { statusChanges } = await scanActivity({
      adapter,
      akbAdapter: mockAkbAdapter,
      vault: VAULT,
      llmAdapter: llm,
      owner: "acme",
      repo: "platform",
      since: "2026-04-06T00:00:00Z",
      projectPrefix: "REEF",
    });

    expect(statusChanges).toHaveLength(0);
    expect(llm.generateText).not.toHaveBeenCalled();
  });
});
