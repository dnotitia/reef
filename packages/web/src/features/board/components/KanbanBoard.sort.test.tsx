import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FILTER_ISSUES,
  KanbanBoard,
  mockApiFetch,
  resetKanbanBoardMocks,
  wrap,
} from "./KanbanBoard.testSupport";

/** True when `a` appears before `b` in document order. */
function isBefore(a: Element, b: Element): boolean {
  return Boolean(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("KanbanBoard in-column sorting (REEF-059)", () => {
  beforeEach(() => {
    resetKanbanBoardMocks();
  });

  // FILTER_ISSUES puts two cards in the Open column:
  //   REEF-010 "UI board polish" (high), REEF-013 "Backend blocker" (medium).
  it("orders cards within a column by issue-wide rank by default (REEF-393)", async () => {
    useIssueStore.setState({
      filter: {},
      searchQuery: "",
      selectedIssueId: null,
    });
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          issues: FILTER_ISSUES.map((issue) =>
            issue.id === "REEF-010"
              ? { ...issue, rank: 2000 }
              : issue.id === "REEF-013"
                ? { ...issue, rank: 1000 }
                : issue,
          ),
        }),
        { status: 200 },
      ),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    const backend = await screen.findByText("Backend blocker");
    const ui = await screen.findByText("UI board polish");
    expect(isBefore(backend, ui)).toBe(true);

    await waitFor(() => {
      const askedRank = mockApiFetch.mock.calls.some(([url]) => {
        const requestUrl = String(url);
        return (
          requestUrl.includes("sort_field=rank") &&
          requestUrl.includes("sort_order=asc")
        );
      });
      expect(askedRank).toBe(true);
    });
  });

  it("orders cards within a column by the selected title sort (A→Z)", async () => {
    useIssueStore.setState({
      filter: { sortField: "title", sortOrder: "asc" },
      searchQuery: "",
      selectedIssueId: null,
    });
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issues: FILTER_ISSUES }), { status: 200 }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    const backend = await screen.findByText("Backend blocker");
    const ui = await screen.findByText("UI board polish");
    // "Backend blocker" < "UI board polish" alphabetically.
    expect(isBefore(backend, ui)).toBe(true);
  });

  it("re-orders the same column by priority (high → low)", async () => {
    useIssueStore.setState({
      filter: { sortField: "priority", sortOrder: "desc" },
      searchQuery: "",
      selectedIssueId: null,
    });
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issues: FILTER_ISSUES }), { status: 200 }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    const ui = await screen.findByText("UI board polish"); // high
    const backend = await screen.findByText("Backend blocker"); // medium
    expect(isBefore(ui, backend)).toBe(true);
  });
});
