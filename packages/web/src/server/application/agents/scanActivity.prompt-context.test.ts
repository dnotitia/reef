import { beforeEach, describe, expect, it } from "vitest";
import {
  VAULT,
  buildCommitsResponse,
  buildPrsResponse,
  makeGitHubAdapter,
  makeLlmAdapter,
  mockAkbAdapter,
  mockListPlanningCatalog,
  mockListTemplates,
  noIssueLinkJson,
  resetScanActivityMocks,
  scanActivity,
  validDraftJson,
} from "./scanActivity.testSupport";

describe("scanActivity prompt context", () => {
  beforeEach(() => {
    resetScanActivityMocks();
  });

  it("includes issue template markdown when generating untracked draft prompts", async () => {
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "templatedSha", message: "feat: fix signup" },
      ]),
      buildPrsResponse(),
    );
    mockListTemplates.mockResolvedValueOnce([
      {
        path: "_reef/templates/bug.md",
        template: {
          name: "bug",
          label: "Bug Report",
          description: "Use for product regressions",
          title_prefix: "Bug: ",
          priority: "high",
          default_labels: ["bug", "needs-triage"],
          body: "## Problem\n\n## Expected Behavior\n",
        },
      },
    ]);
    const llm = makeLlmAdapter([
      { text: JSON.stringify(noIssueLinkJson) },
      { text: JSON.stringify(validDraftJson) },
    ]);

    const { drafts } = await scanActivity({
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
    const generateArgs = llm.generateText.mock.calls[1]?.[0] as {
      prompt: string;
      tools: Record<string, unknown>;
    };
    expect(generateArgs.prompt).toContain("Issue Templates:");
    expect(generateArgs.prompt).toContain("name:bug");
    expect(generateArgs.prompt).toContain("default_labels:[bug, needs-triage]");
    expect(generateArgs.prompt).not.toContain("## Expected Behavior");
    expect(Object.keys(generateArgs.tools).sort()).toEqual([
      "read_issue",
      "read_template",
      "search_documents",
      "search_issues",
    ]);
  });

  it("includes activity date and planning context in untracked draft prompts", async () => {
    const sprintId = "11111111-1111-4111-8111-111111111111";
    mockListPlanningCatalog.mockResolvedValueOnce({
      sprints: [
        {
          id: sprintId,
          name: "Sprint 12",
          status: "active",
          start_date: "2026-04-01",
          end_date: "2026-04-14",
          goal: "Ship onboarding",
        },
      ],
      milestones: [],
      releases: [],
    });
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        {
          oid: "plannedSha",
          message: "feat: Sprint 12 onboarding polish",
          committedDate: "2026-04-08T11:30:00Z",
        },
      ]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify(noIssueLinkJson) },
      { text: JSON.stringify(validDraftJson) },
    ]);

    await scanActivity({
      adapter,
      akbAdapter: mockAkbAdapter,
      vault: VAULT,
      llmAdapter: llm,
      owner: "acme",
      repo: "platform",
      since: "2026-04-06T00:00:00Z",
      projectPrefix: "REEF",
    });

    const generateArgs = llm.generateText.mock.calls[1]?.[0] as {
      prompt: string;
    };
    expect(generateArgs.prompt).toContain(
      "Activity date: 2026-04-08T11:30:00Z",
    );
    expect(generateArgs.prompt).toContain("## Planning Context");
    expect(generateArgs.prompt).toContain(`${sprintId} | Sprint 12`);
  });

  it("keeps only planning IDs that exist in the planning catalog", async () => {
    const sprintId = "11111111-1111-4111-8111-111111111111";
    const milestoneId = "22222222-2222-4222-8222-222222222222";
    const releaseId = "33333333-3333-4333-8333-333333333333";
    mockListPlanningCatalog.mockResolvedValueOnce({
      sprints: [
        {
          id: sprintId,
          name: "Sprint 12",
          status: "active",
          start_date: "2026-04-01",
          end_date: "2026-04-14",
          goal: "",
        },
      ],
      milestones: [
        {
          id: milestoneId,
          name: "Beta",
          status: "todo",
          target_date: "2026-04-30",
          description: "",
        },
      ],
      releases: [
        {
          id: releaseId,
          name: "April",
          status: "planned",
          target_date: "2026-04-30",
          notes: "",
        },
      ],
    });
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([{ oid: "shaPlan", message: "feat: Beta work" }]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify(noIssueLinkJson) },
      {
        text: JSON.stringify({
          ...validDraftJson,
          sprint_id: sprintId,
          milestone_id: milestoneId,
          release_id: "99999999-9999-4999-8999-999999999999",
        }),
      },
    ]);

    const { drafts } = await scanActivity({
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
    expect(drafts[0].proposal.create.fields.sprint_id).toBe(sprintId);
    expect(drafts[0].proposal.create.fields.milestone_id).toBe(milestoneId);
    expect(drafts[0].proposal.create.fields.release_id).toBeUndefined();
  });
});
