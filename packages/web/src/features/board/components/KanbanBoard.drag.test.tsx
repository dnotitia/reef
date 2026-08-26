import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import type { IssueMetadata } from "@reef/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILTER_ISSUES,
  ISSUES,
  KanbanBoard,
  dndHarness,
  mockApiFetch,
  resetKanbanBoardMocks,
  wrap,
} from "./KanbanBoard.testSupport";

function useFieldOrdering() {
  useIssueStore.setState({
    filter: {
      orderingMode: "field",
      sortField: "priority",
      sortOrder: "desc",
    },
  });
}

describe("KanbanBoard drag and status updates", () => {
  beforeEach(() => {
    resetKanbanBoardMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes status when a card is dropped on a different status column", async () => {
    useFieldOrdering();
    mockApiFetch.mockImplementation(async (url, init) => {
      if ((url as string).startsWith("/api/issues?vault=reef-acme")) {
        return new Response(JSON.stringify({ issues: ISSUES }), {
          status: 200,
        });
      }
      if (url === "/api/issues/REEF-001" && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            issue: { ...ISSUES[0], status: "in_progress" },
            content: "",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 500 });
    });

    render(wrap(<KanbanBoard vault="reef-acme" />));
    await screen.findByText("Open A");

    act(() => {
      dndHarness.contextProps?.onDragStart?.({
        active: { data: { current: { issue: ISSUES[0] } } },
      });
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: ISSUES[0] } } },
        over: { id: "in_progress" },
      });
    });

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/issues/REEF-001",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );

    const patchCall = mockApiFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/issues/REEF-001" && init?.method === "PATCH",
    );
    const body = JSON.parse(patchCall?.[1]?.body as string);

    expect(body.vault).toBe("reef-acme");
    expect(body.update).toEqual({
      issue_id: "REEF-001",
      patch: { status: "in_progress" },
    });
  });

  it("asks for a close reason before closing a card from the board", async () => {
    useFieldOrdering();
    const user = userEvent.setup();
    mockApiFetch.mockImplementation(async (url, init) => {
      if ((url as string).startsWith("/api/issues?vault=reef-acme")) {
        return new Response(JSON.stringify({ issues: ISSUES }), {
          status: 200,
        });
      }
      if (url === "/api/issues/REEF-001" && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            issue: { ...ISSUES[0], status: "closed" },
            content: "",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 500 });
    });

    render(wrap(<KanbanBoard vault="reef-acme" />));
    await screen.findByText("Open A");

    act(() => {
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: ISSUES[0] } } },
        over: { id: "closed" },
      });
    });

    expect(await screen.findByTestId("close-issue-dialog")).toBeInTheDocument();
    expect(
      mockApiFetch.mock.calls.some(
        ([url, init]) =>
          url === "/api/issues/REEF-001" && init?.method === "PATCH",
      ),
    ).toBe(false);

    await user.click(screen.getByTestId("closed-reason-select"));
    await user.click(await screen.findByRole("option", { name: /Won't fix/i }));
    await user.click(screen.getByTestId("close-issue-confirm"));

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/issues/REEF-001",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );

    const patchCall = mockApiFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/issues/REEF-001" && init?.method === "PATCH",
    );
    const body = JSON.parse(patchCall?.[1]?.body as string);

    expect(body.update).toEqual({
      issue_id: "REEF-001",
      patch: { status: "closed", closed_reason: "wont_fix" },
    });
  });

  it("PATCHes status when a card is moved backward by the user", async () => {
    useFieldOrdering();
    mockApiFetch.mockImplementation(async (url, init) => {
      if ((url as string).startsWith("/api/issues?vault=reef-acme")) {
        return new Response(JSON.stringify({ issues: ISSUES }), {
          status: 200,
        });
      }
      if (url === "/api/issues/REEF-002" && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            issue: { ...ISSUES[1], status: "todo" },
            content: "",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 500 });
    });

    render(wrap(<KanbanBoard vault="reef-acme" />));
    await screen.findByText("In progress B");

    act(() => {
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: ISSUES[1] } } },
        over: { id: "todo" },
      });
    });

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/issues/REEF-002",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );

    const patchCall = mockApiFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/issues/REEF-002" && init?.method === "PATCH",
    );
    const body = JSON.parse(patchCall?.[1]?.body as string);

    expect(body.update).toEqual({
      issue_id: "REEF-002",
      patch: { status: "todo" },
    });
  });

  it("clears closed metadata when a closed card is moved backward by the user", async () => {
    useFieldOrdering();
    const closedIssue: IssueMetadata = {
      ...ISSUES[1],
      status: "closed",
      closed_at: "2026-05-20T00:00:00.000Z",
      closed_reason: "completed",
    };
    mockApiFetch.mockImplementation(async (url, init) => {
      if ((url as string).startsWith("/api/issues?vault=reef-acme")) {
        return new Response(JSON.stringify({ issues: [closedIssue] }), {
          status: 200,
        });
      }
      if (url === "/api/issues/REEF-002" && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            issue: { ...closedIssue, status: "todo" },
            content: "",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 500 });
    });

    render(wrap(<KanbanBoard vault="reef-acme" />));
    await screen.findByText("In progress B");

    act(() => {
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: closedIssue } } },
        over: { id: "todo" },
      });
    });

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/issues/REEF-002",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );

    const patchCall = mockApiFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/issues/REEF-002" && init?.method === "PATCH",
    );
    const body = JSON.parse(patchCall?.[1]?.body as string);

    expect(body.update).toEqual({
      issue_id: "REEF-002",
      patch: { status: "todo" },
    });
  });

  it("does not PATCH when the card is dropped outside a status column", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issues: ISSUES }), { status: 200 }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));
    await screen.findByText("Open A");

    act(() => {
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: ISSUES[0] } } },
        over: { id: "not-a-status" },
      });
    });

    expect(
      mockApiFetch.mock.calls.some(([url]) => url === "/api/issues/REEF-001"),
    ).toBe(false);
  });

  it("uses the shared bulk patch path for a writable priority group", async () => {
    useFieldOrdering();
    mockApiFetch.mockImplementation(async (url, init) => {
      if ((url as string).startsWith("/api/issues?vault=reef-acme")) {
        return new Response(JSON.stringify({ issues: FILTER_ISSUES }), {
          status: 200,
        });
      }
      if (url === "/api/issues/REEF-010" && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            issue: { ...FILTER_ISSUES[0], priority: "low" },
            content: "",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 500 });
    });

    render(wrap(<KanbanBoard vault="reef-acme" groupBy="priority" />));
    await screen.findByText("UI board polish");

    act(() => {
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: FILTER_ISSUES[0] } } },
        over: { id: "priority:low" },
      });
    });

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/issues/REEF-010",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    const patchCall = mockApiFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/issues/REEF-010" && init?.method === "PATCH",
    );
    expect(JSON.parse(patchCall?.[1]?.body as string).update.patch).toEqual({
      priority: "low",
    });
  });

  it("writes null when a writable grouped field targets None and skips same-value drops", async () => {
    useFieldOrdering();
    mockApiFetch.mockImplementation(async (url, init) => {
      if ((url as string).startsWith("/api/issues?vault=reef-acme")) {
        return new Response(JSON.stringify({ issues: FILTER_ISSUES }), {
          status: 200,
        });
      }
      if (url === "/api/issues/REEF-010" && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            issue: { ...FILTER_ISSUES[0], priority: null },
            content: "",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 500 });
    });

    render(wrap(<KanbanBoard vault="reef-acme" groupBy="priority" />));
    await screen.findByText("UI board polish");

    act(() => {
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: FILTER_ISSUES[0] } } },
        over: { id: "priority:none" },
      });
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: FILTER_ISSUES[0] } } },
        over: { id: "priority:high" },
      });
    });

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/issues/REEF-010",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    const patchCalls = mockApiFetch.mock.calls.filter(
      ([url, init]) =>
        url === "/api/issues/REEF-010" && init?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(1);
    expect(JSON.parse(patchCalls[0]?.[1]?.body as string).update.patch).toEqual(
      {
        priority: null,
      },
    );
  });

  it("disables sensors and drops for label groups while retaining issue cards", async () => {
    mockApiFetch.mockImplementation(async (url) => {
      if ((url as string).startsWith("/api/issues?vault=reef-acme")) {
        return new Response(JSON.stringify({ issues: FILTER_ISSUES }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 500 });
    });

    render(wrap(<KanbanBoard vault="reef-acme" groupBy="label" />));
    await screen.findByText("UI board polish");

    expect(dndHarness.contextProps?.sensors).toEqual([]);
    expect(screen.getAllByTestId("kanban-card").length).toBeGreaterThan(0);
    expect(
      screen.getAllByTitle(/Label groups are read-only/i).length,
    ).toBeGreaterThan(0);

    act(() => {
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: FILTER_ISSUES[0] } } },
        over: { id: "label:ui" },
      });
    });
    expect(
      mockApiFetch.mock.calls.some(
        ([url, init]) =>
          url === "/api/issues/REEF-010" && init?.method === "PATCH",
      ),
    ).toBe(false);
  });

  it("prefers a card collision over its enclosing Board column", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issues: FILTER_ISSUES }), { status: 200 }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));
    await screen.findByText("UI board polish");

    const columnCollision = {
      id: "todo",
      data: {
        droppableContainer: { data: { current: { bucket: true } } },
        value: 1,
      },
    };
    const cardCollision = {
      id: "todo:REEF-010",
      data: {
        droppableContainer: {
          data: { current: { issue: FILTER_ISSUES[0] } },
        },
        value: 2,
      },
    };
    dndHarness.pointerWithin.mockReturnValue([columnCollision, cardCollision]);

    const detect = dndHarness.contextProps?.collisionDetection as (
      args: unknown,
    ) => unknown[];
    expect(detect({})).toEqual([cardCollision]);
  });

  it("disables the Board drop settle animation for reduced-motion users", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issues: FILTER_ISSUES }), { status: 200 }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));
    await screen.findByText("UI board polish");

    expect(dndHarness.overlayProps?.dropAnimation).toBeUndefined();
  });
});
