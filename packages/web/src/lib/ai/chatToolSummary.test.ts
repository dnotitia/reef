// @vitest-environment node

import type { ChatToolStep } from "@/features/ai/chat/chatTypes";
import { describe, expect, it } from "vitest";
import {
  collectReferencedIssueIds,
  extractChatCitations,
  summarizeToolInput,
  toolLabelKey,
  toolResultCount,
} from "./chatToolSummary";

function step(overrides: Partial<ChatToolStep>): ChatToolStep {
  return {
    toolCallId: "c1",
    toolName: "search_issues",
    status: "completed",
    input: null,
    output: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("toolLabelKey", () => {
  it("maps known tools and falls back to generic", () => {
    expect(toolLabelKey("search_issues")).toBe("searchIssues");
    expect(toolLabelKey("search_documents")).toBe("searchDocuments");
    expect(toolLabelKey("mystery_tool")).toBe("generic");
  });
});

describe("summarizeToolInput", () => {
  it("returns the query for search tools and the id for read_issue", () => {
    expect(
      summarizeToolInput(
        step({ toolName: "search_issues", input: { query: "login bug" } }),
      ),
    ).toBe("login bug");
    expect(
      summarizeToolInput(
        step({ toolName: "read_issue", input: { id: "REEF-142" } }),
      ),
    ).toBe("REEF-142");
    expect(
      summarizeToolInput(step({ toolName: "search_issues", input: {} })),
    ).toBeNull();
  });
});

describe("toolResultCount", () => {
  it("counts array results per tool and is null for uncountable tools", () => {
    expect(
      toolResultCount(
        step({ toolName: "search_issues", output: { issues: [1, 2, 3] } }),
      ),
    ).toBe(3);
    expect(
      toolResultCount(
        step({ toolName: "search_documents", output: { documents: [1] } }),
      ),
    ).toBe(1);
    expect(
      toolResultCount(step({ toolName: "read_issue", output: { issue: {} } })),
    ).toBeNull();
  });

  it("is null while a tool is still running", () => {
    expect(
      toolResultCount(step({ status: "running", output: { issues: [1] } })),
    ).toBeNull();
  });
});

describe("extractChatCitations", () => {
  it("dedupes documents from completed search_documents steps (AC4)", () => {
    const steps: ChatToolStep[] = [
      step({
        toolName: "search_documents",
        output: {
          documents: [
            {
              uri: "akb://reef-e2e/coll/decisions/doc/a.md",
              title: "A",
              collection: "decisions",
              doc_type: "decision",
            },
            { uri: "akb://reef-e2e/coll/decisions/doc/a.md", title: "A dup" },
          ],
        },
      }),
      step({
        toolCallId: "c2",
        toolName: "search_documents",
        output: {
          documents: [{ uri: "akb://reef-e2e/doc/b.md", title: null }],
        },
      }),
    ];
    const citations = extractChatCitations(steps);
    expect(citations.map((c) => c.uri)).toEqual([
      "akb://reef-e2e/coll/decisions/doc/a.md",
      "akb://reef-e2e/doc/b.md",
    ]);
    expect(citations[0]).toEqual({
      uri: "akb://reef-e2e/coll/decisions/doc/a.md",
      title: "A",
      collection: "decisions",
      docType: "decision",
    });
  });

  it("ignores non-document tools and running steps", () => {
    expect(
      extractChatCitations([
        step({ toolName: "search_issues", output: { issues: [] } }),
        step({
          status: "running",
          toolName: "search_documents",
          output: { documents: [{ uri: "akb://x/doc/y.md" }] },
        }),
      ]),
    ).toEqual([]);
  });
});

describe("collectReferencedIssueIds", () => {
  it("gathers ids from search_issues hits and the read_issue target (AC3)", () => {
    const ids = collectReferencedIssueIds([
      step({
        toolName: "search_issues",
        output: { issues: [{ id: "REEF-1" }, { id: "REEF-2" }] },
      }),
      step({
        toolCallId: "c2",
        toolName: "read_issue",
        output: { issue: { id: "REEF-3" } },
      }),
    ]);
    expect(ids.sort()).toEqual(["REEF-1", "REEF-2", "REEF-3"]);
  });
});
