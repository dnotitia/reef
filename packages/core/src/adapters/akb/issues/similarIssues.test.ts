import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeIssueQueryResponse,
  makeTestAkbAdapter,
  setupFetch,
} from "../../../agents/tools/__test-helpers__/fetchMock";
import { mockOpenTelemetry } from "../../../agents/tools/__test-helpers__/otelMock";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import {
  DEFAULT_SIMILAR_ISSUE_MIN_SCORE,
  searchSimilarIssues,
} from "./similarIssues";

mockOpenTelemetry();

function makeIssue(overrides: Partial<IssueMetadata>): IssueMetadata {
  return {
    id: "REEF-001",
    title: "Fix the login flow",
    status: "todo",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
    ...overrides,
  };
}

function searchHit(issue: IssueMetadata, score: number | null) {
  return {
    uri: `akb://reef-acme/doc/issues/${issue.id.toLowerCase()}.md`,
    title: issue.id,
    summary: issue.title,
    score,
    matched_section: `Matched ${issue.title}`,
    source_type: "document",
    vault: "reef-acme",
    collection: "issues",
    doc_type: "task",
    tags: issue.labels ?? [],
  };
}

const issues = [
  makeIssue({
    id: "REEF-001",
    title: "Duplicate draft warning",
    status: "todo",
    issue_type: "story",
  }),
  makeIssue({
    id: "REEF-002",
    title: "Low score noise",
    status: "in_progress",
  }),
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchSimilarIssues", () => {
  it("uses akb semantic issue search and keeps hits at or above the score threshold", async () => {
    const { calls } = setupFetch([
      {
        body: {
          results: [
            searchHit(issues[0], DEFAULT_SIMILAR_ISSUE_MIN_SCORE),
            searchHit(issues[1], DEFAULT_SIMILAR_ISSUE_MIN_SCORE - 0.001),
          ],
        },
      },
      { body: makeIssueQueryResponse([issues[0]]) },
    ]);

    const result = await searchSimilarIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      title: "duplicate draft warning",
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: "REEF-001",
        title: "Duplicate draft warning",
        score: DEFAULT_SIMILAR_ISSUE_MIN_SCORE,
        matched_section: "Matched Duplicate draft warning",
      }),
    ]);

    const searchUrl = new URL(calls[0].url);
    expect(searchUrl.pathname).toBe("/api/v1/search");
    expect(searchUrl.searchParams.get("vault")).toBe("reef-acme");
    expect(searchUrl.searchParams.get("collection")).toBe("issues");
    expect(searchUrl.searchParams.get("type")).toBe("task");
    expect(searchUrl.searchParams.get("q")).toBe("duplicate draft warning");
  });

  it("does not show hits whose score is missing", async () => {
    setupFetch([{ body: { results: [searchHit(issues[0], null)] } }]);

    await expect(
      searchSimilarIssues({
        adapter: makeTestAkbAdapter(),
        vault: "reef-acme",
        title: "duplicate draft warning",
      }),
    ).resolves.toEqual([]);
  });

  it("short-circuits queries shorter than three characters", async () => {
    const { calls } = setupFetch([]);

    await expect(
      searchSimilarIssues({
        adapter: makeTestAkbAdapter(),
        vault: "reef-acme",
        title: "ab",
      }),
    ).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
