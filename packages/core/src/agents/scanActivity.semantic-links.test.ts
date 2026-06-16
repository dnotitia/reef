import { beforeEach, describe, expect, it } from "vitest";
import {
  VAULT,
  buildCommitsResponse,
  buildPrsResponse,
  groundedIssueLinkResponse,
  linkedIssueJson,
  makeGitHubAdapter,
  makeLlmAdapter,
  mockAkbAdapter,
  mockReadIssue,
  noIssueLinkJson,
  possibleIssueLinkJson,
  resetScanActivityMocks,
  scanActivity,
  validDraftJson,
} from "./scanActivity.testSupport";

describe("scanActivity semantic links", () => {
  beforeEach(() => {
    resetScanActivityMocks();
  });

  it("rejects semantic links whose issue id does not match the project prefix", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "wrongPrefix", message: "fix login redirect fallback" },
      ]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify(linkedIssueJson("OTHER-023")) },
      { text: JSON.stringify(validDraftJson) },
    ]);

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

    expect(statusChanges).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(mockReadIssue).not.toHaveBeenCalled();
  });

  it("rejects semantic links whose issue id was not grounded by linker tool results", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "ungroundedIssue", message: "auth redirect fix" },
      ]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      {
        text: JSON.stringify(linkedIssueJson("REEF-023")),
        toolResults: [
          {
            type: "tool-result",
            toolName: "search_issues",
            output: {
              issues: [{ id: "REEF-999" }],
            },
          },
        ],
      },
      { text: JSON.stringify(validDraftJson) },
    ]);

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

    expect(statusChanges).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(mockReadIssue).not.toHaveBeenCalled();
  });

  it("maps semantically linked merged PRs to done and commit-only activity to in_progress", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "semanticCommit", message: "fix login redirect fallback" },
      ]),
      buildPrsResponse([
        {
          number: 92,
          title: "Complete auth redirect repair",
          body: "Finishes the auth redirect work.",
          mergedAt: "2026-04-07T12:30:00Z",
        },
      ]),
    );
    const llm = makeLlmAdapter([
      groundedIssueLinkResponse("REEF-024"),
      groundedIssueLinkResponse("REEF-025"),
      { text: JSON.stringify({ rationale: "Commit work has started." }) },
      {
        text: JSON.stringify({
          rationale: "The merged PR completes the work.",
        }),
      },
    ]);
    mockReadIssue
      .mockResolvedValueOnce({
        issue: { title: "Commit-linked issue", status: "todo" },
        content: "",
      })
      .mockResolvedValueOnce({
        issue: { title: "PR-linked issue", status: "in_review" },
        content: "",
      })
      .mockResolvedValueOnce({
        issue: { title: "Commit-linked issue", status: "todo" },
        content: "",
      })
      .mockResolvedValueOnce({
        issue: { title: "PR-linked issue", status: "in_review" },
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
    expect(
      statusChanges.map((s) => [
        s.proposal.update.issue_id,
        s.proposal.update.patch.status,
      ]),
    ).toEqual([
      ["REEF-024", "in_progress"],
      ["REEF-025", "done"],
    ]);
  });

  it("keeps possible semantic links in the draft path", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([]),
      buildPrsResponse([
        {
          number: 93,
          title: "Tune login copy",
          body: "Small wording change near the login redirect.",
        },
      ]),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify(possibleIssueLinkJson) },
      { text: JSON.stringify(validDraftJson) },
    ]);

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

    expect(statusChanges).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(mockReadIssue).not.toHaveBeenCalled();
  });

  it("keeps low-confidence semantic links in the draft path", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([{ oid: "lowConfidence", message: "auth cleanup" }]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      groundedIssueLinkResponse("REEF-023", 0.81),
      { text: JSON.stringify(validDraftJson) },
    ]);

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

    expect(statusChanges).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(mockReadIssue).not.toHaveBeenCalled();
  });

  it("falls back to drafts when semantic linking returns malformed JSON", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([{ oid: "badJson", message: "auth redirect fix" }]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      { text: "{ not json" },
      { text: JSON.stringify(validDraftJson) },
    ]);

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

    expect(statusChanges).toHaveLength(0);
    expect(drafts).toHaveLength(1);
  });

  it("falls back to drafts when semantic linking returns an issue id that cannot be read", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "missingIssue", message: "auth redirect fix" },
      ]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      groundedIssueLinkResponse("REEF-404"),
      { text: JSON.stringify(validDraftJson) },
    ]);
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

    expect(statusChanges).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(mockReadIssue).toHaveBeenCalledTimes(1);
  });

  it("returns no status change when the LLM responds 'null' (trivial activity)", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "shaTrivial", message: "chore: REEF-007 lint" },
      ]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([{ text: "null" }]);
    mockReadIssue.mockResolvedValueOnce({
      issue: { title: "Some issue", status: "todo" },
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
  });
});
