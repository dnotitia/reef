import type { IssueMetadata } from "@reef/core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  KanbanBoard,
  dndHarness,
  mockApiFetch,
  resetKanbanBoardMocks,
  wrap,
} from "./KanbanBoard.testSupport";

const BACKLOG_ISSUES: IssueMetadata[] = [
  {
    id: "REEF-101",
    title: "Critical backlog item",
    status: "backlog",
    priority: "critical",
    rank: 1000,
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
  {
    id: "REEF-102",
    title: "High backlog item",
    status: "backlog",
    priority: "high",
    rank: 2000,
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
];

function mockBacklogApi() {
  mockApiFetch.mockImplementation(async (url, init) => {
    if (String(url).startsWith("/api/issues?vault=reef-acme")) {
      return new Response(JSON.stringify({ issues: BACKLOG_ISSUES }), {
        status: 200,
      });
    }
    if (url === "/api/issues/reorder") {
      return new Response(JSON.stringify({ ok: true, assignments: [] }), {
        status: 200,
      });
    }
    if (url === "/api/issues/REEF-101" && init?.method === "PATCH") {
      return new Response(
        JSON.stringify({
          issue: { ...BACKLOG_ISSUES[0], priority: "high" },
          content: "",
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  });
}

describe("KanbanBoard backlog scope", () => {
  beforeEach(() => {
    resetKanbanBoardMocks();
    mockBacklogApi();
  });

  it("renders fixed Priority columns and rank-sorts reverse-input cards inside one column", async () => {
    const rows = [
      BACKLOG_ISSUES[0],
      { ...BACKLOG_ISSUES[1], rank: 3000 },
      {
        ...BACKLOG_ISSUES[1],
        id: "REEF-103",
        title: "Earlier high backlog item",
        rank: 2000,
      },
    ];
    mockApiFetch.mockImplementation(async (url) =>
      Response.json(
        String(url).startsWith("/api/issues?vault=reef-acme")
          ? { issues: rows }
          : {},
      ),
    );
    render(wrap(<KanbanBoard vault="reef-acme" scope="backlog" />));
    await screen.findByText("Earlier high backlog item");
    const columns = screen
      .getByTestId("kanban-board-body")
      .querySelectorAll('[data-group-by="priority"]');
    expect(
      Array.from(
        columns,
        (column) =>
          within(column as HTMLElement).getByRole("heading", { level: 3 })
            .textContent,
      ),
    ).toEqual(["Critical", "High", "Medium", "Low", "None"]);
    const highColumn = screen
      .getByRole("heading", { name: "High", level: 3 })
      .closest<HTMLElement>('[data-group-by="priority"]');
    if (!highColumn) throw new Error("missing High column");
    expect(
      within(highColumn)
        .getAllByTestId("kanban-card")
        .map((card) => card.dataset.issueId),
    ).toEqual(["REEF-103", "REEF-102"]);
    expect(screen.getByTestId("kanban-board")).toBeInTheDocument();
  });

  it("reorders Rank without a priority patch inside one Priority column", async () => {
    const samePriority = BACKLOG_ISSUES.map((issue) => ({
      ...issue,
      priority: "high" as const,
    }));
    mockApiFetch.mockImplementation(async (url, init) => {
      if (String(url).startsWith("/api/issues?vault=reef-acme")) {
        return new Response(JSON.stringify({ issues: samePriority }), {
          status: 200,
        });
      }
      if (url === "/api/issues/reorder") {
        return new Response(JSON.stringify({ ok: true, assignments: [] }), {
          status: 200,
        });
      }
      if (init?.method === "PATCH") return new Response("{}", { status: 500 });
      return new Response("{}", { status: 200 });
    });
    render(wrap(<KanbanBoard vault="reef-acme" scope="backlog" />));
    await screen.findByText("Critical backlog item");

    act(() => {
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: samePriority[0] } } },
        over: { id: "priority:high" },
      });
    });

    await waitFor(() =>
      expect(
        mockApiFetch.mock.calls.some(([url]) => url === "/api/issues/reorder"),
      ).toBe(true),
    );
    expect(
      mockApiFetch.mock.calls.some(
        ([url, init]) =>
          url === "/api/issues/REEF-101" && init?.method === "PATCH",
      ),
    ).toBe(false);
  });

  it("sends the priority update and Rank reorder as one command when crossing Priority columns", async () => {
    render(wrap(<KanbanBoard vault="reef-acme" scope="backlog" />));
    await screen.findByText("Critical backlog item");

    act(() => {
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: BACKLOG_ISSUES[0] } } },
        over: { id: "priority:high" },
      });
    });

    await waitFor(() =>
      expect(
        mockApiFetch.mock.calls.some(([url]) => url === "/api/issues/reorder"),
      ).toBe(true),
    );
    const reorderCall = mockApiFetch.mock.calls.find(
      ([url]) => url === "/api/issues/reorder",
    );
    const body = JSON.parse(reorderCall?.[1]?.body as string);
    expect(body.scope).toBe("backlog");
    expect(body.issue_id).toBe("REEF-101");
    expect(body.group).toEqual({ field: "priority", value: "high" });
    expect(
      mockApiFetch.mock.calls.some(
        ([url, init]) =>
          url === "/api/issues/REEF-101" && init?.method === "PATCH",
      ),
    ).toBe(false);
  });
});
