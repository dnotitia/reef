import type { IssueListItem } from "@reef/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KanbanColumn, STATUS_LABELS } from "./KanbanColumn";

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

// Stub auto-animate so its controller's setState doesn't trigger a second
// render that would consume the one-shot useDroppable mock below.
vi.mock("@formkit/auto-animate/react", () => ({
  useAutoAnimate: () => [vi.fn()],
}));

import { useDroppable } from "@dnd-kit/core";
import type { KanbanColumnProps } from "./KanbanColumn";

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
  }: {
    issue: IssueListItem;
    onClick?: (id: string) => void;
  }) => (
    <button
      type="button"
      data-testid="kanban-card"
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
    renderColumn({ status: "todo", issues: [] });
    expect(
      screen.getByRole("heading", { name: STATUS_LABELS.todo }),
    ).toBeDefined();
  });

  it("renders in_progress label correctly", () => {
    renderColumn({ status: "in_progress", issues: [] });
    expect(screen.getByRole("heading", { name: "In Progress" })).toBeDefined();
  });

  it("renders correct number of cards", () => {
    const issues = [makeTestIssue("reef-001"), makeTestIssue("reef-002")];
    renderColumn({ status: "todo", issues });
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

    const { container } = renderColumn({ status: "todo", issues: [] });
    const col = container.firstChild as HTMLElement;
    expect(col.className).toContain("border-brand");
    expect(col.className).toContain("ring-brand/30");
  });

  it("does not apply hover class when isOver is false", () => {
    const { container } = renderColumn({ status: "todo", issues: [] });
    const col = container.firstChild as HTMLElement;
    expect(col.className).toContain("border-border");
    expect(col.className).not.toContain("border-brand");
  });

  it("forwards onIssueClick to each card", () => {
    const onIssueClick = vi.fn();
    const issues = [makeTestIssue("reef-001"), makeTestIssue("reef-002")];
    renderColumn({ status: "todo", issues, onIssueClick });
    fireEvent.click(screen.getAllByTestId("kanban-card")[1]);
    expect(onIssueClick).toHaveBeenCalledWith("reef-002");
  });
});
