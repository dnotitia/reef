import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { render, screen } from "@testing-library/react";
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
