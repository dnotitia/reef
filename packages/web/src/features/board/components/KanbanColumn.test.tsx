import type { IssueListItem } from "@reef/core";
import { ISSUE_FIELD_MESSAGES_EN } from "@reef/core/fields";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KanbanColumn } from "./KanbanColumn";

afterEach(() => {
  cleanup();
});

// Mock @dnd-kit/core to avoid JSDOM drag issues
vi.mock("@dnd-kit/core", () => ({
  useDroppable: vi.fn(() => ({
    setNodeRef: vi.fn(),
    isOver: false,
  })),
  useDraggable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  })),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Translate: { toString: () => "" } },
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: vi.fn(),
}));

// Stub auto-animate so its controller's setState doesn't trigger a second
// render that would consume the one-shot useDroppable mock below.
vi.mock("@formkit/auto-animate/react", () => ({
  useAutoAnimate: () => [vi.fn()],
}));

import { useDroppable } from "@dnd-kit/core";
import type { KanbanColumnProps } from "./KanbanColumn";
import type { IssueGroupBucket } from "../../issues/lib/grouping";

function statusBucket(status: "todo" | "in_progress"): IssueGroupBucket {
  return {
    groupBy: "status",
    id: status,
    label: ISSUE_FIELD_MESSAGES_EN.status[status],
    value: status,
    order: status === "todo" ? 0 : 1,
    patchField: "status",
    patchValue: status,
    multiBucket: false,
    droppable: true,
  };
}

function epicBucket(): IssueGroupBucket {
  return {
    groupBy: "epic",
    id: "epic:REEF-100",
    label: "Foundation Epic",
    value: "REEF-100",
    order: 0,
    patchField: null,
    patchValue: null,
    multiBucket: false,
    droppable: false,
    epic: {
      id: "REEF-100",
      title: "Foundation Epic",
      status: "in_progress",
      issue_type: "epic",
      parent_id: null,
      rank: 1,
      depends_on: [],
    },
    progress: { done: 1, total: 2 },
  };
}

const makeTestIssue = (id: string): IssueListItem => ({
  id,
  title: `Issue ${id}`,
  status: "todo",
  created_at: "2026-04-13T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-04-13T00:00:00.000Z",
  updated_by: "alice",
});

// Mock KanbanCard so column tests don't depend on draggable internals
vi.mock("./KanbanCard", () => ({
  KanbanCard: ({
    issue,
    onClick,
    readOnlyReason,
    dragEnabled,
  }: {
    issue: IssueListItem;
    onClick?: (id: string) => void;
    readOnlyReason?: string;
    dragEnabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid="kanban-card"
      data-read-only-reason={readOnlyReason}
      data-drag-enabled={String(dragEnabled)}
      onClick={() => onClick?.(issue.id)}
    >
      {issue.title}
    </button>
  ),
}));

function renderColumn(props: KanbanColumnProps) {
  return render(<KanbanColumn {...props} />);
}

describe("KanbanColumn", () => {
  it("renders column title matching status label", () => {
    renderColumn({ bucket: statusBucket("todo"), issues: [] });
    expect(
      screen.getByRole("heading", {
        name: ISSUE_FIELD_MESSAGES_EN.status.todo,
      }),
    ).toBeDefined();
  });

  it("renders in_progress label correctly", () => {
    renderColumn({ bucket: statusBucket("in_progress"), issues: [] });
    expect(screen.getByRole("heading", { name: "In Progress" })).toBeDefined();
  });

  it("renders correct number of cards", () => {
    const issues = [makeTestIssue("reef-001"), makeTestIssue("reef-002")];
    renderColumn({ bucket: statusBucket("todo"), issues });
    expect(screen.getAllByTestId("kanban-card")).toHaveLength(2);
  });

  it("applies brand-ring hover class when isOver is true", () => {
    vi.mocked(useDroppable).mockReturnValueOnce({
      setNodeRef: vi.fn(),
      isOver: true,
      over: null,
      active: null,
      rect: { current: null },
      node: { current: null },
    });

    const { container } = renderColumn({
      bucket: statusBucket("todo"),
      issues: [],
    });
    const col = container.firstChild as HTMLElement;
    expect(col.className).toContain("border-brand-focus");
    expect(col.className).toContain("ring-brand-focus/30");
  });

  it("does not apply hover class when isOver is false", () => {
    const { container } = renderColumn({
      bucket: statusBucket("todo"),
      issues: [],
    });
    const col = container.firstChild as HTMLElement;
    expect(col.className).toContain("border-border");
    expect(col.className).toContain("bg-surface-subtle");
    expect(col.className).not.toContain("border-brand-focus");
  });

  it("registers the descriptor bucket as the droppable payload", () => {
    const bucket = statusBucket("todo");
    vi.mocked(useDroppable).mockClear();

    renderColumn({ bucket, issues: [] });

    expect(useDroppable).toHaveBeenCalledWith({
      id: bucket.id,
      data: { bucket },
      disabled: false,
    });
  });

  it("forwards onIssueClick to each card", () => {
    const onIssueClick = vi.fn();
    const issues = [makeTestIssue("reef-001"), makeTestIssue("reef-002")];
    renderColumn({ bucket: statusBucket("todo"), issues, onIssueClick });
    fireEvent.click(screen.getAllByTestId("kanban-card")[1]);
    expect(onIssueClick).toHaveBeenCalledWith("reef-002");
  });

  it("opens a root Epic from its keyboard-focusable header without enabling drops", () => {
    const onGroupClick = vi.fn();
    renderColumn({
      bucket: epicBucket(),
      issues: [],
      onGroupClick,
      dragEnabled: false,
    });

    const header = screen.getByTestId("open-epic-REEF-100");
    expect(header).toHaveAccessibleName("Open Epic REEF-100: Foundation Epic");
    fireEvent.keyDown(header, { key: "Enter" });
    fireEvent.click(header);
    expect(onGroupClick).toHaveBeenCalledWith("REEF-100");
    expect(vi.mocked(useDroppable)).toHaveBeenLastCalledWith({
      id: "epic:REEF-100",
      data: { bucket: epicBucket() },
      disabled: true,
    });
    expect(screen.getByText("1 of 2 done or closed")).toBeInTheDocument();
  });

  it("keeps Epic child cards interactive while the group remains read-only", () => {
    const onIssueClick = vi.fn();
    renderColumn({
      bucket: epicBucket(),
      issues: [makeTestIssue("reef-001")],
      onIssueClick,
      dragEnabled: false,
      readOnlyReason: "Epic groups are read-only",
    });

    expect(screen.getByTestId("epic-group-read-only")).toHaveTextContent(
      "Epic groups are read-only",
    );
    const card = screen.getByTestId("kanban-card");
    expect(card).not.toHaveAttribute("data-read-only-reason");
    expect(card).toHaveAttribute("data-drag-enabled", "false");
    fireEvent.click(card);
    expect(onIssueClick).toHaveBeenCalledWith("reef-001");
  });
});
