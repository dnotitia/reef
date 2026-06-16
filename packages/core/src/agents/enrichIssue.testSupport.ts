import { vi } from "vitest";
import type { AkbAdapter } from "../adapters/akb";
import type { GitHubAdapter } from "../adapters/github";
import type { LlmAdapter } from "../adapters/llm";
import type {
  EnrichmentContext,
  EnrichmentRequest,
} from "../schemas/ai/enrichment";

const {
  mockListIssues,
  mockListTemplates,
  mockListPlanningCatalog,
  mockListVaultMembers,
  mockReadConfig,
} = vi.hoisted(() => ({
  mockListIssues: vi.fn(),
  mockListTemplates: vi.fn(),
  mockListPlanningCatalog: vi.fn(),
  mockListVaultMembers: vi.fn(),
  mockReadConfig: vi.fn(),
}));

export { mockListIssues, mockListPlanningCatalog, mockReadConfig };

vi.mock("../adapters/akb", async (importOriginal) => {
  const original = await importOriginal<typeof import("../adapters/akb")>();
  return {
    ...original,
    listIssues: mockListIssues,
    listTemplates: mockListTemplates,
    listPlanningCatalog: mockListPlanningCatalog,
    listVaultMembers: mockListVaultMembers,
    readConfig: mockReadConfig,
  };
});

export function mockAdapter(
  text: string,
  meta: { finishReason?: string; completionTokens?: number } = {},
): LlmAdapter {
  return {
    model: vi.fn(),
    streamText: vi.fn(),
    // v5 LanguageModelV2Usage uses inputTokens / outputTokens / totalTokens
    // (renamed from v4 promptTokens / completionTokens).
    generateText: vi.fn().mockResolvedValue({
      text,
      finishReason: meta.finishReason ?? "stop",
      usage: {
        inputTokens: 100,
        outputTokens: meta.completionTokens ?? text.length,
        totalTokens: 100 + (meta.completionTokens ?? text.length),
      },
    }),
  } as unknown as LlmAdapter;
}

export function mockAdapterSequence(texts: string[]): LlmAdapter {
  const generateText = vi.fn();
  for (const text of texts) {
    generateText.mockResolvedValueOnce({
      text,
      finishReason: "stop",
      usage: {
        inputTokens: 100,
        outputTokens: text.length,
        totalTokens: 100 + text.length,
      },
    });
  }
  return {
    model: vi.fn(),
    streamText: vi.fn(),
    generateText,
  } as unknown as LlmAdapter;
}

// biome-ignore lint/suspicious/noExplicitAny: mock adapter for tests
export const stubGithubAdapter = {} as any as GitHubAdapter;

export const baseRequest: EnrichmentRequest = {
  issueId: "REEF-001",
  vault: "reef-acme",
  draft: {
    fields: {
      title: "Fix login",
      issue_type: "bug",
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
    content: "Auth flow broken",
  },
  repoContext: {
    owner: "octo",
    repo: "cat",
  },
};

export const baseContext: EnrichmentContext = {
  labels: [],
  members: [],
  templates: [],
  knownIssueIds: ["REEF-002"],
};

export function resetEnrichIssueMocks() {
  mockListIssues.mockReset();
  mockListTemplates.mockReset();
  mockListPlanningCatalog.mockReset();
  mockListVaultMembers.mockReset();
  mockReadConfig.mockReset();
  mockListIssues.mockResolvedValue({ issues: [] });
  mockListTemplates.mockResolvedValue([]);
  mockListPlanningCatalog.mockResolvedValue({
    sprints: [],
    milestones: [],
    releases: [],
  });
  mockListVaultMembers.mockResolvedValue({ members: [] });
  mockReadConfig.mockResolvedValue({
    exists: true,
    config: {
      project_prefix: "REEF",
      monitored_repos: [{ github_id: 1, owner: "octo", name: "cat" }],
    },
  });
}

export { enrichIssue } from "./enrichIssue";
