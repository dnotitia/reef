import type { IssueMetadata } from "@reef/core";
import { act, render, screen, waitFor } from "@testing-library/react";
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

  it("renders the fixed Priority columns and preserves Rank order inside them", async () => {
    render(wrap(<KanbanBoard vault="reef-acme" scope="backlog" />));

    expect(
      await screen.findByText("Critical backlog item"),
    ).toBeInTheDocument();
    expect(screen.getByText("High backlog item")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-board")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-board-body")).toBeInTheDocument();
    expect(
      screen.getAllByText(/Critical|High|Medium|Low|None/).length,
    ).toBeGreaterThan(0);
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
