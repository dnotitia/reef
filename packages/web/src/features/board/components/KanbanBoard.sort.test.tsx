import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { IssueMetadata } from "@reef/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FILTER_ISSUES,
  KanbanBoard,
  dndHarness,
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

  it("preserves the server's canonical order for the selected title sort (A→Z)", async () => {
    useIssueStore.setState({
      filter: { sortField: "title", sortOrder: "asc" },
      searchQuery: "",
      selectedIssueId: null,
    });
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          // The title comparator is owned by the server's ICU collation; the
          // board must not re-sort only the loaded rows after pagination.
          issues: [
            FILTER_ISSUES[3],
            FILTER_ISSUES[0],
            FILTER_ISSUES[1],
            FILTER_ISSUES[2],
          ],
        }),
        { status: 200 },
      ),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    const backend = await screen.findByText("Backend blocker");
    const ui = await screen.findByText("UI board polish");
    // The response is already canonical and the board preserves that order.
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

  it("orders the same column by numeric ticket number in either direction", async () => {
    useIssueStore.setState({
      filter: { sortField: "reef_id", sortOrder: "asc" },
      searchQuery: "",
      selectedIssueId: null,
    });
    const rows = FILTER_ISSUES.map((issue, index) => ({
      ...issue,
      id: index === 0 ? "TEAM_2-1000" : index === 1 ? "TEAM_2-999" : issue.id,
    }));
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issues: rows }), { status: 200 }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    const oneThousand = await screen.findByText("UI board polish");
    const nineNinetyNine = await screen.findByText("Backend blocker");
    expect(isBefore(nineNinetyNine, oneThousand)).toBe(true);
  });

  it("reorders the same Manual Board group through the shared rank command", async () => {
    const manualIssues = FILTER_ISSUES.map((issue) =>
      issue.id === "REEF-010"
        ? { ...issue, rank: 1000 }
        : issue.id === "REEF-013"
          ? { ...issue, rank: 2000 }
          : issue,
    );
    mockApiFetch.mockImplementation(async (url) => {
      if (String(url).startsWith("/api/issues?vault=reef-acme")) {
        return new Response(JSON.stringify({ issues: manualIssues }), {
          status: 200,
        });
      }
      if (url === "/api/issues/reorder") {
        return new Response(
          JSON.stringify({
            ok: true,
            assignments: [{ id: "REEF-013", rank: 0 }],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });

    render(wrap(<KanbanBoard vault="reef-acme" />));
    await screen.findByText("Backend blocker");

    act(() => {
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: manualIssues[3] } } },
        over: { id: "todo:REEF-010" },
      });
    });

    await waitFor(() =>
      expect(
        mockApiFetch.mock.calls.some(([url]) => url === "/api/issues/reorder"),
      ).toBe(true),
    );
    const call = mockApiFetch.mock.calls.find(
      ([url]) => url === "/api/issues/reorder",
    );
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({
      scope: "active",
      issue_id: "REEF-013",
      before_id: null,
      after_id: "REEF-010",
    });
    expect(body.group).toBeUndefined();
  });

  it.each([
    {
      groupBy: "status" as const,
      overId: "in_review",
      source: { status: "todo" as const },
      target: { field: "status" as const, value: "in_review" },
    },
    {
      groupBy: "priority" as const,
      overId: "priority:medium",
      source: { priority: "high" as const },
      target: { field: "priority" as const, value: "medium" },
    },
    {
      groupBy: "assignee" as const,
      overId: "assignee:none",
      source: { assigned_to: "alice" },
      target: { field: "assigned_to" as const, value: null },
    },
    {
      groupBy: "sprint" as const,
      overId: "sprint:none",
      source: { sprint_id: "sprint-1" },
      target: { field: "sprint_id" as const, value: null },
    },
  ])(
    "uses canonical anchors for an empty $groupBy bucket and sends one group+rank command",
    async ({ groupBy, overId, source, target }) => {
      const moved: IssueMetadata = {
        id: "REEF-003",
        title: "Moved issue",
        status: "todo",
        rank: 3000,
        created_at: "2026-05-01T00:00:00.000Z",
        created_by: "alice",
        updated_at: "2026-05-01T00:00:00.000Z",
        updated_by: "alice",
        ...source,
      };
      const interleaved: IssueMetadata = {
        id: "REEF-001",
        title: "Interleaved issue",
        status: "in_progress",
        rank: 1000,
        created_at: "2026-05-01T00:00:00.000Z",
        created_by: "alice",
        updated_at: "2026-05-01T00:00:00.000Z",
        updated_by: "alice",
      };
      const rows = [moved, interleaved];
      mockApiFetch.mockImplementation(async (url) => {
        if (String(url).startsWith("/api/issues?vault=reef-acme")) {
          return new Response(JSON.stringify({ issues: rows }), {
            status: 200,
          });
        }
        if (url === "/api/issues/reorder") {
          return new Response(JSON.stringify({ ok: true, assignments: [] }), {
            status: 200,
          });
        }
        if (String(url).startsWith("/api/issues/relations")) {
          return new Response(JSON.stringify({ relations: [] }), {
            status: 200,
          });
        }
        return new Response("{}", { status: 200 });
      });

      render(wrap(<KanbanBoard vault="reef-acme" groupBy={groupBy} />));
      expect(await screen.findByText("Moved issue")).toBeInTheDocument();

      act(() => {
        dndHarness.contextProps?.onDragEnd?.({
          active: { data: { current: { issue: moved } } },
          over: { id: overId },
        });
      });

      await waitFor(() =>
        expect(
          mockApiFetch.mock.calls.some(
            ([url]) => url === "/api/issues/reorder",
          ),
        ).toBe(true),
      );
      const call = mockApiFetch.mock.calls.find(
        ([url]) => url === "/api/issues/reorder",
      );
      const body = JSON.parse(String(call?.[1]?.body));
      expect(body).toMatchObject({
        scope: "active",
        issue_id: "REEF-003",
        before_id: "REEF-001",
        after_id: null,
        group: target,
      });
    },
  );
});
