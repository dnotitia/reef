import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { IssueMetadata } from "@reef/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openIssueHarness = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/features/issues/hooks/view/useOpenIssue", () => ({
  useOpenIssue: () => openIssueHarness.open,
}));
import {
  KanbanBoard,
  dndHarness,
  mockApiFetch,
  resetKanbanBoardMocks,
  wrap,
} from "./KanbanBoard.testSupport";
import {
  statusEpicBucketId,
  statusEpicOccurrenceKey,
} from "../../issues/lib/grouping";

const EPIC_ISSUES: IssueMetadata[] = [
  {
    id: "INDEPENDENT",
    title: "Independent issue",
    status: "todo",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
  {
    id: "EPIC-001",
    title: "Outcome epic",
    status: "in_progress",
    issue_type: "epic",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
  {
    id: "CHILD-TODO",
    title: "Todo child",
    status: "todo",
    issue_type: "story",
    parent_id: "EPIC-001",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
  {
    id: "CHILD-DONE",
    title: "Done child",
    status: "done",
    issue_type: "task",
    parent_id: "EPIC-001",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
  {
    id: "CHILD-CLOSED",
    title: "Closed child",
    status: "closed",
    issue_type: "task",
    parent_id: "EPIC-001",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
  {
    id: "GRANDCHILD",
    title: "Grandchild issue",
    status: "todo",
    issue_type: "task",
    parent_id: "CHILD-TODO",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
];

function issueApiResponse(url: unknown) {
  if (String(url).startsWith("/api/issues/relations")) {
    return new Response(JSON.stringify({ relations: [] }), { status: 200 });
  }
  return new Response(JSON.stringify({ issues: EPIC_ISSUES }), { status: 200 });
}

function mockEpicBoard() {
  mockApiFetch.mockImplementation(async (url, init) => {
    if (url === "/api/issues/CHILD-TODO" && init?.method === "PATCH") {
      return new Response(
        JSON.stringify({
          issue: { ...EPIC_ISSUES[2], status: "in_review" },
          content: "",
        }),
        { status: 200 },
      );
    }
    return issueApiResponse(url);
  });
}

describe("KanbanBoard epic lanes", () => {
  beforeEach(() => {
    resetKanbanBoardMocks();
    mockEpicBoard();
  });

  it("renders one full-width lane with direct child progress and status distribution", async () => {
    render(wrap(<KanbanBoard vault="reef-acme" />));

    const lane = await screen.findByTestId("kanban-epic-lane");
    expect(lane).toHaveAccessibleName(/Outcome epic/);
    expect(lane).toHaveAccessibleDescription(/Epic Outcome epic/);
    expect(screen.getByTestId("kanban-epic-progress")).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
    expect(screen.getByTestId("kanban-epic-progress")).toHaveAttribute(
      "aria-valuemax",
      "3",
    );
    expect(screen.getByTestId("kanban-epic-progress-text")).toHaveTextContent(
      "2 of 3 child issues done",
    );
    expect(
      screen.getByTestId("kanban-epic-status-distribution"),
    ).toHaveTextContent("Todo 1, Done 1, Closed 1");

    expect(screen.getByText("Todo child")).toBeInTheDocument();
    expect(screen.getByText("Done child")).toBeInTheDocument();
    expect(screen.getByText("Closed child")).toBeInTheDocument();
    expect(screen.getByText("Independent issue")).toBeInTheDocument();
    expect(screen.getByText("Grandchild issue")).toBeInTheDocument();
    expect(screen.queryByTestId("kanban-hierarchy-fallback")).toHaveAttribute(
      "data-hierarchy-fallback",
      "deeper_chain",
    );

    await waitFor(() => {
      const occurrences =
        useIssueKeyboardStore.getState().visibleOccurrences.board;
      expect(occurrences).toHaveLength(6);
      expect(
        occurrences.filter(({ issueId }) => issueId === "EPIC-001"),
      ).toHaveLength(1);
      for (const issueId of ["CHILD-TODO", "CHILD-DONE", "CHILD-CLOSED"]) {
        expect(
          occurrences.filter((occurrence) => occurrence.issueId === issueId),
        ).toHaveLength(1);
      }
    });

    const toggle = within(lane).getByRole("button", {
      name: "Collapse epic Outcome epic",
    });
    const children = screen.getByTestId("kanban-epic-children");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", children.id);
  });

  it("keeps lane status groups visible with each child rendered once", async () => {
    render(wrap(<KanbanBoard vault="reef-acme" />));

    const lane = await screen.findByTestId("kanban-epic-lane");
    const childRegion = within(lane).getByTestId("kanban-epic-children");
    for (const [status, title] of [
      ["Todo", "Todo child"],
      ["Done", "Done child"],
      ["Closed", "Closed child"],
    ] as const) {
      const column = within(childRegion).getByLabelText(`${status}, 1`);
      expect(within(column).getByText(title)).toBeInTheDocument();
    }
    for (const title of ["Todo child", "Done child", "Closed child"]) {
      expect(screen.getAllByText(title)).toHaveLength(1);
    }
  });

  it("collapses children, removes them from keyboard occurrences, and restores them on expand", async () => {
    const user = userEvent.setup();
    render(wrap(<KanbanBoard vault="reef-acme" />));

    const lane = await screen.findByTestId("kanban-epic-lane");
    const toggle = within(lane).getByRole("button", {
      name: "Collapse epic Outcome epic",
    });
    const identity = within(lane).getByRole("button", {
      name: /EPIC-001.*Outcome epic/,
    });

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Todo child")).not.toBeInTheDocument();
    expect(screen.queryByText("Done child")).not.toBeInTheDocument();
    await waitFor(() => {
      const occurrences =
        useIssueKeyboardStore.getState().visibleOccurrences.board;
      expect(occurrences.map(({ issueId }) => issueId)).not.toContain(
        "CHILD-TODO",
      );
      expect(occurrences).toContainEqual({
        key: statusEpicOccurrenceKey("EPIC-001"),
        issueId: "EPIC-001",
      });
    });
    expect(identity).toHaveFocus();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Todo child")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        useIssueKeyboardStore
          .getState()
          .visibleOccurrences.board.some(
            ({ issueId }) => issueId === "CHILD-TODO",
          ),
      ).toBe(true),
    );

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Todo child")).not.toBeInTheDocument();
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Todo child")).toBeInTheDocument();
  });

  it("keeps epic identity click, keyboard activation, context menu, and quick edit behavior", async () => {
    const user = userEvent.setup();
    render(wrap(<KanbanBoard vault="reef-acme" />));

    const lane = await screen.findByTestId("kanban-epic-lane");
    const identity = within(lane).getByRole("button", {
      name: /EPIC-001.*Outcome epic/,
    });
    await user.click(identity);
    expect(openIssueHarness.open).toHaveBeenCalledWith("EPIC-001");

    openIssueHarness.open.mockClear();
    identity.focus();
    await user.keyboard("{Enter}");
    expect(openIssueHarness.open).toHaveBeenCalledWith("EPIC-001");

    fireEvent.keyDown(identity, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    act(() => {
      useIssueKeyboardStore.getState().requestQuickEdit("board", "status");
    });
    expect(await screen.findByTestId("issue-quick-edit-anchor")).toBeVisible();
  });

  it("keeps a child flat with a localized fallback when its filtered-out epic is absent", async () => {
    useIssueStore.setState({
      filter: { status: ["todo"] },
      searchQuery: "",
      selectedIssueId: null,
    });
    render(wrap(<KanbanBoard vault="reef-acme" />));

    expect(await screen.findByText("Todo child")).toBeInTheDocument();
    expect(screen.queryByTestId("kanban-epic-lane")).not.toBeInTheDocument();
    const childCard = screen
      .getByText("Todo child")
      .closest('[data-testid="kanban-card"]');
    expect(childCard).not.toBeNull();
    expect(
      within(childCard as HTMLElement).getByTestId("kanban-hierarchy-fallback"),
    ).toHaveTextContent(
      "Parent is not visible; showing this issue as a standalone card.",
    );
    expect(
      within(childCard as HTMLElement)
        .getByTestId("kanban-hierarchy-fallback")
        .getAttribute("data-hierarchy-fallback"),
    ).toBe("parent_not_visible");
  });

  it("uses the Korean catalog for lane actions and accessible progress copy", async () => {
    render(
      wrap(
        <IntlTestProvider locale="ko">
          <KanbanBoard vault="reef-acme" />
        </IntlTestProvider>,
      ),
    );

    const lane = await screen.findByTestId("kanban-epic-lane");
    expect(
      within(lane).getByRole("button", { name: "에픽 Outcome epic 접기" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("kanban-epic-progress-text")).toHaveTextContent(
      "하위 이슈 3개 중 2개 완료",
    );
    expect(
      screen.getByTestId("kanban-epic-status-distribution"),
    ).toHaveTextContent("상태 분포:");
  });

  it("moves a child through the lane with one status patch and no parent or epic mutation", async () => {
    render(wrap(<KanbanBoard vault="reef-acme" />));
    await screen.findByText("Todo child");

    act(() => {
      dndHarness.contextProps?.onDragEnd?.({
        active: {
          data: {
            current: {
              issue: EPIC_ISSUES[2],
            },
          },
        },
        over: {
          id: statusEpicBucketId("EPIC-001", "in_review"),
        },
      });
    });

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/issues/CHILD-TODO",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    const patchCalls = mockApiFetch.mock.calls.filter(
      ([url, init]) =>
        typeof url === "string" &&
        url.startsWith("/api/issues/") &&
        init?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(1);
    const body = JSON.parse(patchCalls[0]?.[1]?.body as string);
    expect(body.update).toEqual({
      issue_id: "CHILD-TODO",
      patch: { status: "in_review" },
    });
    expect(body.update.patch.parent_id).toBeUndefined();
    expect(patchCalls.some(([url]) => url === "/api/issues/EPIC-001")).toBe(
      false,
    );
  });
});
