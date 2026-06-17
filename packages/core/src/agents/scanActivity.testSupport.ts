import { beforeEach, vi } from "vitest";
import type { AkbAdapter } from "../adapters/akb";
import type { GitHubAdapter } from "../adapters/github";
import type { LlmAdapter } from "../adapters/llm";
import type { ScanActivityParams } from "./scanActivity";

const {
  mockListIssues,
  mockListPlanningCatalog,
  mockListTemplates,
  mockReadIssue,
} = vi.hoisted(() => ({
  mockListIssues: vi.fn(),
  mockListPlanningCatalog: vi.fn(),
  mockListTemplates: vi.fn(),
  mockReadIssue: vi.fn(),
}));

export { mockListPlanningCatalog, mockListTemplates, mockReadIssue };

vi.mock("../adapters/akb", async (importOriginal) => {
  const original = await importOriginal<typeof import("../adapters/akb")>();
  return {
    ...original,
    listIssues: mockListIssues,
    listPlanningCatalog: mockListPlanningCatalog,
    listTemplates: mockListTemplates,
    readIssue: mockReadIssue,
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

type MockedLlmAdapter = LlmAdapter & {
  generateText: ReturnType<typeof vi.fn>;
};

type MockedGitHubAdapter = GitHubAdapter & {
  listRecentActivity: ReturnType<typeof vi.fn>;
};

export function makeLlmAdapter(
  responses: Array<{ text: string } & Record<string, unknown>>,
): MockedLlmAdapter {
  const generateText = vi.fn();
  for (const response of responses) {
    generateText.mockResolvedValueOnce(response);
  }
  const adapter = {
    model: vi.fn().mockReturnValue({} as ReturnType<LlmAdapter["model"]>),
    streamText: vi.fn() as LlmAdapter["streamText"],
    generateText: generateText as unknown as LlmAdapter["generateText"],
  };
  return adapter as unknown as MockedLlmAdapter;
}

export function makeGitHubAdapter(
  commitsResponse: unknown,
  prsResponse: unknown,
): MockedGitHubAdapter {
  const commitNodes = extractCommitNodes(commitsResponse);
  const prNodes = extractPrNodes(prsResponse);
  const listRecentActivity = vi.fn(({ since }: { since?: string | null }) => ({
    commits: commitNodes,
    pullRequests: since
      ? prNodes.filter((pr) => {
          const updatedAt = (pr as { updatedAt?: unknown }).updatedAt;
          return (
            typeof updatedAt === "string" &&
            new Date(updatedAt) >= new Date(since)
          );
        })
      : prNodes,
  }));
  const adapter = {
    listRecentActivity:
      listRecentActivity as unknown as GitHubAdapter["listRecentActivity"],
  };
  return adapter as unknown as MockedGitHubAdapter;
}

function extractCommitNodes(response: unknown): unknown[] {
  const repository = (response as { repository?: unknown }).repository;
  const defaultBranchRef = (
    repository as { defaultBranchRef?: unknown } | undefined
  )?.defaultBranchRef;
  const target = (defaultBranchRef as { target?: unknown } | null | undefined)
    ?.target;
  const history = (target as { history?: unknown } | undefined)?.history;
  const nodes = (history as { nodes?: unknown } | undefined)?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}

function extractPrNodes(response: unknown): unknown[] {
  const repository = (response as { repository?: unknown }).repository;
  const pullRequests = (repository as { pullRequests?: unknown } | undefined)
    ?.pullRequests;
  const nodes = (pullRequests as { nodes?: unknown } | undefined)?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}

export const mockAkbAdapter = { request: vi.fn() } as unknown as AkbAdapter;

export const VAULT = "reef-acme";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

export function buildCommitsResponse(
  nodes: Array<{
    oid: string;
    message: string;
    actor?: string;
    authoredDate?: string;
    committedDate?: string;
  }>,
): unknown {
  return {
    repository: {
      defaultBranchRef: {
        target: {
          history: {
            nodes: nodes.map((n) => ({
              oid: n.oid,
              message: n.message,
              authoredDate: n.authoredDate ?? "2026-04-07T09:00:00Z",
              committedDate: n.committedDate ?? "2026-04-07T10:00:00Z",
              author: {
                name: n.actor ?? "alicedev",
                user: { login: n.actor ?? "alicedev" },
              },
              changedFilesIfAvailable: 1,
              associatedPullRequests: { nodes: [] },
            })),
          },
        },
      },
    },
  };
}

export function buildPrsResponse(
  nodes: Array<{
    number: number;
    title: string;
    body?: string;
    actor?: string;
    headRefName?: string;
    createdAt?: string;
    updatedAt?: string;
    mergedAt?: string | null;
    commitMessages?: string[];
  }> = [],
): unknown {
  return {
    repository: {
      pullRequests: {
        nodes: nodes.map((n) => ({
          number: n.number,
          title: n.title,
          body: n.body ?? "",
          headRefName: n.headRefName ?? `feat/${n.number}`,
          author: { login: n.actor ?? "carol" },
          createdAt: n.createdAt ?? "2026-04-07T08:00:00Z",
          updatedAt: n.updatedAt ?? "2026-04-07T12:00:00Z",
          mergedAt: n.mergedAt ?? null,
          commits: {
            nodes: (n.commitMessages ?? ["feat: step 1"]).map((message) => ({
              commit: { message },
            })),
          },
        })),
      },
    },
  };
}

export const validDraftJson = {
  title: "Add rate limiting to API endpoints",
  content:
    "Implemented request rate limiting across all public API endpoints to prevent abuse.",
  priority: "high",
  labels: ["api", "security"],
  reasoning: "PR adds security middleware affecting all API consumers.",
  confidence: 0.88,
};

export const noIssueLinkJson = {
  decision: "no_link",
  issue_id: null,
  confidence: 0.2,
  rationale: "No existing issue matches this activity.",
};

export const possibleIssueLinkJson = {
  decision: "possible_link",
  issue_id: "REEF-042",
  confidence: 0.7,
  rationale: "The activity may be related, but the scope is ambiguous.",
};

export function linkedIssueJson(issueId: string, confidence = 0.9) {
  return {
    decision: "linked",
    issue_id: issueId,
    confidence,
    rationale: "The activity clearly matches the existing issue.",
  };
}

export function groundedIssueLinkResponse(issueId: string, confidence = 0.9) {
  const normalizedIssueId = issueId.trim().toUpperCase();
  return {
    text: JSON.stringify(linkedIssueJson(issueId, confidence)),
    toolResults: [
      {
        type: "tool-result",
        toolName: "search_issues",
        output: {
          issues: [{ id: normalizedIssueId }],
        },
      },
      {
        type: "tool-result",
        toolName: "read_issue",
        output: {
          issue: { id: normalizedIssueId },
          content: "",
        },
      },
    ],
  };
}

const emptyPlanningCatalog = {
  sprints: [],
  milestones: [],
  releases: [],
};

export function resetScanActivityMocks() {
  mockListIssues.mockReset();
  mockListIssues.mockResolvedValue({ issues: [] });
  mockListTemplates.mockReset();
  mockListTemplates.mockResolvedValue([]);
  mockListPlanningCatalog.mockReset();
  mockListPlanningCatalog.mockResolvedValue(emptyPlanningCatalog);
  mockReadIssue.mockReset();
}

export type { ScanActivityParams };
export { scanActivity } from "./scanActivity";
