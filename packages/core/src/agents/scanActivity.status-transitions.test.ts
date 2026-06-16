import { beforeEach, describe, expect, it } from "vitest";
import {
  PendingDraftSchema,
  PendingStatusChangeSchema,
} from "../schemas/activity/pendingDraft";
import { getAgentRegistryEntry } from "./framework/registry";
import {
  VAULT,
  buildCommitsResponse,
  buildPrsResponse,
  groundedIssueLinkResponse,
  makeGitHubAdapter,
  makeLlmAdapter,
  mockAkbAdapter,
  mockReadIssue,
  noIssueLinkJson,
  resetScanActivityMocks,
  scanActivity,
  validDraftJson,
} from "./scanActivity.testSupport";

describe("scanActivity status transitions", () => {
  beforeEach(() => {
    resetScanActivityMocks();
  });

  it("proposes 'done' when a merged PR references an in-review issue", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([]),
      buildPrsResponse([
        {
          number: 42,
          title: "Implement login fix",
          body: "Closes REEF-042",
          mergedAt: "2026-04-07T12:30:00Z",
        },
      ]),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify({ rationale: "The PR was merged." }) },
    ]);
    mockReadIssue.mockResolvedValueOnce({
      issue: { title: "Login fix", status: "in_review" },
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

    expect(statusChanges).toHaveLength(1);
    expect(statusChanges[0].fromStatus).toBe("in_review");
    expect(statusChanges[0].proposal.update.patch.status).toBe("done");
    expect(statusChanges[0].confidence).toBe(0.9);
  });

  it("proposes a forward jump to 'done' for a merged PR on an in_progress issue", async () => {
    // in_progress -> done is a multi-step forward jump: not a single legal
    // board transition, but a merged PR means the work is complete, so the
    // suggestion advances straight to done rather than being dropped.
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([]),
      buildPrsResponse([
        {
          number: 43,
          title: "Finish the feature",
          body: "Closes REEF-050",
          mergedAt: "2026-04-07T12:30:00Z",
        },
      ]),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify({ rationale: "The PR was merged." }) },
    ]);
    mockReadIssue.mockResolvedValueOnce({
      issue: { title: "Feature", status: "in_progress" },
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

    expect(statusChanges).toHaveLength(1);
    expect(statusChanges[0].fromStatus).toBe("in_progress");
    expect(statusChanges[0].proposal.update.patch.status).toBe("done");
  });

  it("creates a status change when an ID-less open PR is semantically linked to an existing issue", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([]),
      buildPrsResponse([
        {
          number: 91,
          title: "Fix login redirect after session refresh",
          body: "Restores redirect behavior after auth renewal.",
          headRefName: "fix/login-redirect",
          mergedAt: null,
        },
      ]),
    );
    const llm = makeLlmAdapter([
      groundedIssueLinkResponse("reef-023 "),
      {
        text: JSON.stringify({
          rationale: "The open PR is ready for review on the linked issue.",
        }),
      },
    ]);
    mockReadIssue
      .mockResolvedValueOnce({
        issue: { title: "Login redirect bug", status: "in_progress" },
        content: "",
      })
      .mockResolvedValueOnce({
        issue: { title: "Login redirect bug", status: "in_progress" },
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
    expect(statusChanges[0].proposal.update.issue_id).toBe("REEF-023");
    expect(statusChanges[0].fromStatus).toBe("in_progress");
    expect(statusChanges[0].proposal.update.patch.status).toBe("in_review");
    expect(statusChanges[0].evidence).toEqual([
      { type: "pr", ref: "91", repo: "acme/platform", actor: "carol" },
    ]);
    const linkArgs = llm.generateText.mock.calls[0]?.[0] as {
      prompt: string;
      tools: Record<string, unknown>;
    };
    expect(linkArgs.prompt).toContain(
      "GitHub Activity Without Explicit Issue ID",
    );
    expect(Object.keys(linkArgs.tools).sort()).toEqual([
      "read_issue",
      "search_issues",
    ]);
  });

  it("respects dismissedRefs for both untracked and tracked branches", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "dismissedUntracked", message: "feat: new feature" },
        {
          oid: "dismissedTracked",
          message: "fix: REEF-100 something",
        },
      ]),
      buildPrsResponse([
        { number: 50, title: "Tracked PR", body: "Closes REEF-200" },
      ]),
    );
    const llm = makeLlmAdapter([]); // no LLM calls expected

    const { drafts, statusChanges } = await scanActivity({
      adapter,
      akbAdapter: mockAkbAdapter,
      vault: VAULT,
      llmAdapter: llm,
      owner: "acme",
      repo: "platform",
      since: "2026-04-06T00:00:00Z",
      projectPrefix: "REEF",
      dismissedRefs: [
        "acme/platform:commit:dismissedUntracked",
        "acme/platform:commit:dismissedTracked",
        "acme/platform:pr:50",
      ],
    });

    expect(drafts).toHaveLength(0);
    expect(statusChanges).toHaveLength(0);
    expect(llm.generateText).not.toHaveBeenCalled();
    expect(mockReadIssue).not.toHaveBeenCalled();
  });

  it("returned PendingDraft + PendingStatusChange objects pass schema validation", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "shaUntracked", message: "feat: untracked work" },
        { oid: "shaTracked", message: "fix: REEF-300 in progress" },
      ]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify(noIssueLinkJson) },
      { text: JSON.stringify(validDraftJson) },
      { text: JSON.stringify({ rationale: "Work started." }) },
    ]);
    mockReadIssue.mockResolvedValueOnce({
      issue: { title: "Third issue", status: "todo" },
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

    for (const d of drafts) {
      expect(PendingDraftSchema.safeParse(d).success).toBe(true);
    }
    for (const s of statusChanges) {
      expect(PendingStatusChangeSchema.safeParse(s).success).toBe(true);
    }
  });

  it("extracts issue refs from PR headRefName and commit messages, not just title/body", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([]),
      buildPrsResponse([
        {
          number: 77,
          title: "Refactor checkout",
          body: "No issue ref in title or body.",
          headRefName: "feat/REEF-555-checkout",
          commitMessages: ["wip", "more wip"],
        },
        {
          number: 88,
          title: "Tune cache",
          body: "Body without ref.",
          headRefName: "feat/no-ref",
          commitMessages: ["chore: tune", "fix: REEF-666 expiry"],
        },
      ]),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify({ rationale: "Checkout work under review." }) },
      { text: JSON.stringify({ rationale: "Cache work under review." }) },
    ]);
    // Open PRs map to "in_review", a legal forward move from "in_progress".
    mockReadIssue
      .mockResolvedValueOnce({
        issue: { title: "Checkout", status: "in_progress" },
        content: "",
      })
      .mockResolvedValueOnce({
        issue: { title: "Cache", status: "in_progress" },
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
    expect(statusChanges.map((s) => s.proposal.update.issue_id).sort()).toEqual(
      ["REEF-555", "REEF-666"],
    );
    expect(
      statusChanges.every(
        (s) => s.proposal.update.patch.status === "in_review",
      ),
    ).toBe(true);
    const firstGenerateArgs = llm.generateText.mock.calls[0]?.[0] as {
      experimental_telemetry?: { functionId?: string };
      tools?: unknown;
    };
    expect(firstGenerateArgs.experimental_telemetry?.functionId).toBe(
      getAgentRegistryEntry("activity.status-change").functionId,
    );
    expect(firstGenerateArgs.tools).toBeUndefined();
  });
});
