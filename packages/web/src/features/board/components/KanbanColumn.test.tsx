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
    dragRestrictionReason,
    dragEnabled,
  }: {
    issue: IssueListItem;
    onClick?: (id: string) => void;
    dragRestrictionReason?: string;
    dragEnabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid="kanban-card"
      data-drag-restriction-reason={dragRestrictionReason}
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
    expect(screen.getByTestId("kanban-group-header")).toHaveClass(
      "items-center",
      "gap-2",
      "px-1.5",
      "py-1",
    );
    expect(
      screen.getByRole("heading", {
        name: ISSUE_FIELD_MESSAGES_EN.status.todo,
      }),
    ).toHaveClass("type-board-status");
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

  it("keeps the Epic header to label/count and opens its detail control", () => {
    const onGroupClick = vi.fn();
    renderColumn({
      bucket: epicBucket(),
      issues: [],
      onGroupClick,
      dragEnabled: false,
    });

    const header = screen.getByTestId("epic-group-header");
    expect(header.querySelector("h3")).toHaveClass("type-board-epic");
    const openEpic = screen.getByTestId("open-epic-REEF-100");
    expect(screen.getByTestId("epic-group-header")).toHaveClass(
      "items-center",
      "gap-2",
      "px-1.5",
      "py-1",
    );
    expect(header).toHaveTextContent("REEF-100");
    expect(header).toHaveTextContent("Foundation Epic");
    expect(header).toHaveTextContent("0");
    expect(header).not.toHaveTextContent("In Progress");
    expect(header).not.toHaveTextContent("1 of 2 done or closed");
    const column = header.parentElement;
    if (!column) throw new Error("Missing Epic column");
    expect(column).toHaveAttribute(
      "aria-label",
      "Epic REEF-100: Foundation Epic; status In Progress; 0 visible children; 1 of 2 done or closed",
    );
    expect(openEpic).toHaveAccessibleName(
      "Open Epic REEF-100: Foundation Epic",
    );
    expect(openEpic.querySelector("svg")).toBeInTheDocument();
    expect(openEpic).not.toHaveTextContent("REEF-100");
    fireEvent.keyDown(openEpic, { key: "Enter" });
    fireEvent.click(openEpic);
    expect(onGroupClick).toHaveBeenCalledWith("REEF-100");
    expect(vi.mocked(useDroppable)).toHaveBeenLastCalledWith({
      id: "epic:REEF-100",
      data: { bucket: epicBucket() },
      disabled: true,
    });
    expect(screen.getByTestId("epic-group-header")).not.toHaveTextContent(
      "1 of 2 done or closed",
    );
  });

  it("keeps a long Epic label on one line with a full title tooltip", () => {
    const longTitle =
      "A very long product outcome title that stays compact in the group header";
    const bucket = epicBucket();
    bucket.label = longTitle;
    if (!bucket.epic) throw new Error("Missing Epic metadata");
    bucket.epic = { ...bucket.epic, title: longTitle };

    renderColumn({ bucket, issues: [], onGroupClick: vi.fn() });

    const header = screen.getByTestId("epic-group-header");
    const openEpic = screen.getByTestId("open-epic-REEF-100");
    const title = header.querySelector(`span[title="${longTitle}"]`);
    expect(openEpic).toHaveAttribute("title", longTitle);
    expect(title).toHaveClass("truncate");
    expect(openEpic).not.toHaveTextContent(longTitle);
  });

  it("keeps Epic child cards interactive while the group remains drag-restricted", () => {
    const onIssueClick = vi.fn();
    renderColumn({
      bucket: epicBucket(),
      issues: [makeTestIssue("reef-001")],
      onIssueClick,
      dragEnabled: false,
      dragRestrictionReason: "Epic groups cannot be moved by dragging",
    });

    expect(screen.queryByTestId("epic-group-read-only")).toBeNull();
    expect(screen.getByTestId("epic-group-header")).not.toHaveTextContent(
      /In Progress|1 of 2 done or closed/,
    );
    const card = screen.getByTestId("kanban-card");
    expect(card).not.toHaveAttribute("data-drag-restriction-reason");
    expect(card).toHaveAttribute("data-drag-enabled", "false");
    fireEvent.click(card);
    expect(onIssueClick).toHaveBeenCalledWith("reef-001");
  });
});
