import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";

// Capture the retry helper so the effect-free onError path can be asserted.
const { notifyReorderFailure, notifyRetryableError } = vi.hoisted(() => ({
  notifyReorderFailure: vi.fn(),
  notifyRetryableError: vi.fn(),
}));
vi.mock("@/components/ui/toastFeedback", () => ({
  notifyReorderFailure,
  notifyRetryableError,
  kanbanToastId: (id: string) => `kanban:${id}`,
}));

import {
  ISSUES,
  KanbanBoard,
  dndHarness,
  mockApiFetch,
  resetKanbanBoardMocks,
  wrap,
} from "./KanbanBoard.testSupport";

describe("KanbanBoard status-update errors", () => {
  beforeEach(() => {
    resetKanbanBoardMocks();
    useIssueStore.setState({
      filter: {
        orderingMode: "field",
        sortField: "priority",
        sortOrder: "desc",
      },
    });
    notifyReorderFailure.mockReset();
    notifyRetryableError.mockReset();
  });

  it("surfaces a non-retry conflict notice for a stale Manual reorder", async () => {
    useIssueStore.setState({ filter: { orderingMode: "manual" } });
    mockApiFetch.mockImplementation(async (url, init) => {
      if ((url as string).startsWith("/api/issues?vault=reef-acme")) {
        return new Response(
          JSON.stringify({
            issues: ISSUES.map((issue, index) => ({
              ...issue,
              rank: (index + 1) * 1000,
            })),
          }),
          { status: 200 },
        );
      }
      if (url === "/api/issues/reorder" && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "Save conflict" }), {
          status: 409,
        });
      }
      return new Response("{}", { status: 200 });
    });

    render(wrap(<KanbanBoard vault="reef-acme" />));
    await screen.findByText("Open A");

    act(() => {
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: ISSUES[0] } } },
        over: { id: "in_progress" },
      });
    });

    await waitFor(() => expect(notifyReorderFailure).toHaveBeenCalledTimes(1));
    expect(notifyRetryableError).not.toHaveBeenCalled();
    expect(notifyReorderFailure.mock.calls[0][0]).toMatchObject({
      status: 409,
    });
    expect(notifyReorderFailure.mock.calls[0][1]).toMatchObject({
      id: "kanban:REEF-001",
    });
  });

  it("surfaces a retryable error toast from onError (not a mount effect) when a move fails", async () => {
    // First PATCH fails; the retry (re-run of the same input) succeeds.
    let patchCount = 0;
    mockApiFetch.mockImplementation(async (url, init) => {
      if ((url as string).startsWith("/api/issues?vault=reef-acme")) {
        return new Response(JSON.stringify({ issues: ISSUES }), {
          status: 200,
        });
      }
      if (url === "/api/issues/REEF-001" && init?.method === "PATCH") {
        patchCount += 1;
        if (patchCount === 1) {
          return new Response(JSON.stringify({ error: "boom" }), {
            status: 500,
          });
        }
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
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: ISSUES[0] } } },
        over: { id: "in_progress" },
      });
    });

    await waitFor(() => expect(notifyRetryableError).toHaveBeenCalledTimes(1));
    const options = notifyRetryableError.mock.calls[0][0];
    expect(options.id).toBe("kanban:REEF-001");
    expect(typeof options.onRetry).toBe("function");
    expect(patchCount).toBe(1);

    // Retry re-runs the exact same status move.
    act(() => {
      options.onRetry();
    });

    await waitFor(() => expect(patchCount).toBe(2));
    const patchCalls = mockApiFetch.mock.calls.filter(
      ([url, init]) =>
        url === "/api/issues/REEF-001" && init?.method === "PATCH",
    );
    const body = JSON.parse(
      patchCalls[patchCalls.length - 1]?.[1]?.body as string,
    );
    expect(body.update).toEqual({
      issue_id: "REEF-001",
      patch: { status: "in_progress" },
    });
    // A successful retry does not raise another error toast.
    expect(notifyRetryableError).toHaveBeenCalledTimes(1);
  });

  it("surfaces a retry toast for each overlapping failed move (per-request, not shared callbacks)", async () => {
    // The board stays draggable while a PATCH is in flight, so a second move can
    // start before the first resolves. With mutateAsync each request owns its
    // own rejection; mutate's single-observer onError would be overwritten by
    // the second move and drop the first move's retry toast.
    mockApiFetch.mockImplementation(async (url, init) => {
      const u = url as string;
      if (u.startsWith("/api/issues?vault=reef-acme")) {
        return new Response(JSON.stringify({ issues: ISSUES }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/issues/") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      }
      return new Response("{}", { status: 500 });
    });

    render(wrap(<KanbanBoard vault="reef-acme" />));
    await screen.findByText("Open A");

    // Two overlapping moves dispatched back-to-back.
    act(() => {
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: ISSUES[0] } } },
        over: { id: "in_progress" },
      });
      dndHarness.contextProps?.onDragEnd?.({
        active: { data: { current: { issue: ISSUES[1] } } },
        over: { id: "todo" },
      });
    });

    await waitFor(() => expect(notifyRetryableError).toHaveBeenCalledTimes(2));
    const ids = notifyRetryableError.mock.calls.map((c) => c[0].id);
    expect(ids).toContain("kanban:REEF-001");
    expect(ids).toContain("kanban:REEF-002");
  });
});
