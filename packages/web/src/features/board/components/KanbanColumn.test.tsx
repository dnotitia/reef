import type { IssueListItem } from "@reef/core";
import { ISSUE_FIELD_MESSAGES_EN } from "@reef/core/fields";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanColumn } from "./KanbanColumn";

const virtualizerProbe = vi.hoisted(() => ({
  scrollToIndex: vi.fn((index: number) => {
    virtualizerProbe.scrollIndex = index;
  }),
  sortableItems: [] as (string | number)[],
  scrollIndex: 0,
}));

vi.mock("@tanstack/react-virtual", () => ({
  defaultRangeExtractor: (range: {
    startIndex: number;
    endIndex: number;
    overscan: number;
    count: number;
  }) =>
    Array.from(
      {
        length: Math.max(
          0,
          Math.min(range.count - 1, range.endIndex + range.overscan) -
            Math.max(0, range.startIndex - range.overscan) +
            1,
        ),
      },
      (_, index) => Math.max(0, range.startIndex - range.overscan) + index,
    ),
  useVirtualizer: (options: {
    count: number;
    getItemKey: (index: number) => string | number;
    rangeExtractor: (range: {
      startIndex: number;
      endIndex: number;
      overscan: number;
      count: number;
    }) => number[];
  }) => {
    const startIndex = Math.max(0, virtualizerProbe.scrollIndex - 2);
    const endIndex = Math.min(options.count - 1, startIndex + 5);
    const indexes = options.rangeExtractor({
      startIndex,
      endIndex,
      overscan: 0,
      count: options.count,
    });
    return {
      getVirtualItems: () =>
        indexes.map((index) => ({
          index,
          key: options.getItemKey(index),
          start: index * 180,
          size: 180,
        })),
      getTotalSize: () => options.count * 180,
      measureElement: vi.fn(),
      scrollToIndex: virtualizerProbe.scrollToIndex,
    };
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
  SortableContext: ({
    children,
    items,
  }: {
    children: ReactNode;
    items: (string | number)[];
  }) => {
    virtualizerProbe.sortableItems = items;
    return <>{children}</>;
  },
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
import {
  useIssueKeyboardStore,
  type BoardViewportAnchor,
} from "../../issues/stores/useIssueKeyboardStore";

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
    occurrenceKey,
    onClick,
    dragRestrictionReason,
    dragEnabled,
  }: {
    issue: IssueListItem;
    occurrenceKey: string;
    onClick?: (id: string) => void;
    dragRestrictionReason?: string;
    dragEnabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid="kanban-card"
      data-occurrence-key={occurrenceKey}
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
  beforeEach(() => {
    virtualizerProbe.scrollIndex = 0;
    virtualizerProbe.scrollToIndex.mockClear();
    virtualizerProbe.sortableItems = [];
    useIssueKeyboardStore.setState({
      focusRequest: null,
      quickEditRequest: null,
      focusedIssueId: { list: null, board: null, backlog: null },
      focusedOccurrenceKey: { list: null, board: null, backlog: null },
      tabStopIssueId: { list: null, board: null, backlog: null },
      tabStopOccurrenceKey: { list: null, board: null, backlog: null },
      visibleIssueIds: { list: [], board: [], backlog: [] },
      visibleOccurrences: { list: [], board: [], backlog: [] },
    });
  });

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

  it("bounds mounted cards without changing the full column count", () => {
    const issues = Array.from({ length: 300 }, (_, index) =>
      makeTestIssue(`reef-${String(index + 1).padStart(3, "0")}`),
    );
    const { container } = renderColumn({
      bucket: statusBucket("todo"),
      issues,
    });

    expect(container.firstChild).toHaveAttribute("aria-label", "Todo, 300");
    expect(
      container.querySelectorAll('[data-testid="kanban-card"]').length,
    ).toBeLessThan(issues.length);
    expect(virtualizerProbe.sortableItems).toHaveLength(issues.length);
    expect(virtualizerProbe.sortableItems.at(-1)).toBe("todo:reef-300");
  });

  it("keeps the actively dragged card mounted outside the normal range", () => {
    const issues = Array.from({ length: 300 }, (_, index) =>
      makeTestIssue(`reef-${String(index + 1).padStart(3, "0")}`),
    );
    const { container } = renderColumn({
      bucket: statusBucket("todo"),
      issues,
      activeIssueId: "reef-201",
    });

    expect(
      container.querySelectorAll('[data-testid="kanban-card"]'),
    ).toHaveLength(7);
    expect(
      screen.getByRole("button", { name: "Issue reef-201" }),
    ).toBeDefined();
  });

  it("scrolls the virtualized column to a keyboard focus request", () => {
    const issues = Array.from({ length: 10 }, (_, index) =>
      makeTestIssue(`reef-${String(index + 1).padStart(3, "0")}`),
    );
    useIssueKeyboardStore.getState().setVisibleOccurrences(
      "board",
      issues.map((issue) => ({
        key: `todo:${issue.id}`,
        issueId: issue.id,
      })),
    );

    const { rerender } = renderColumn({
      bucket: statusBucket("todo"),
      issues,
    });
    act(() => {
      useIssueKeyboardStore
        .getState()
        .focusOccurrence("board", "todo:reef-009", "reef-009", {
          requestDomFocus: true,
        });
    });

    expect(virtualizerProbe.scrollToIndex).toHaveBeenCalledWith(8, {
      align: "auto",
    });

    act(() => {
      useIssueKeyboardStore
        .getState()
        .focusOccurrence("board", "todo:reef-009", "reef-009", {
          requestDomFocus: true,
        });
    });
    rerender(<KanbanColumn bucket={statusBucket("todo")} issues={issues} />);
    expect(
      screen.getByRole("button", { name: "Issue reef-009" }),
    ).toBeDefined();
  });

  it("restores an already-focused mounted occurrence without an intermediate scroll", () => {
    const issues = Array.from({ length: 10 }, (_, index) =>
      makeTestIssue(`reef-${String(index + 1).padStart(3, "0")}`),
    );
    const anchor: BoardViewportAnchor = {
      bucketId: "todo",
      occurrenceKey: "todo:reef-005",
      issueId: "reef-005",
      offset: 670,
      itemOffset: 50,
      focused: true,
    };
    const continuityKey = "alice:reef-e2e";
    const initialProps: KanbanColumnProps = {
      bucket: statusBucket("todo"),
      continuityKey,
      issues,
    };
    useIssueKeyboardStore.setState({
      focusedIssueId: { list: null, board: anchor.issueId, backlog: null },
      focusedOccurrenceKey: {
        list: null,
        board: anchor.occurrenceKey,
        backlog: null,
      },
    });
    const { rerender } = renderColumn(initialProps);

    const scrollElement = screen.getByTestId("kanban-column-scroll-container");
    const targetCard = screen.getByRole("button", {
      name: "Issue reef-005",
    });
    vi.spyOn(scrollElement, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 320, 480),
    );
    vi.spyOn(targetCard, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 150, 320, 88),
    );
    (scrollElement as HTMLElement).scrollTop = anchor.offset;
    targetCard.focus();

    expect(
      useIssueKeyboardStore.getState().boardViewportAnchors[continuityKey],
    ).toMatchObject(anchor);
    virtualizerProbe.scrollToIndex.mockClear();

    rerender(<KanbanColumn {...initialProps} restoreAnchor={anchor} />);

    expect(virtualizerProbe.scrollToIndex).not.toHaveBeenCalled();
    expect((scrollElement as HTMLElement).scrollTop).toBe(anchor.offset);
    expect(document.activeElement).toBe(targetCard);
  });

  it("cancels a pending restore when the same focused occurrence gets a newer anchor", () => {
    const issues = Array.from({ length: 10 }, (_, index) =>
      makeTestIssue(`reef-${String(index + 1).padStart(3, "0")}`),
    );
    const continuityKey = "alice:reef-e2e";
    const occurrenceKey = "todo:reef-005";
    const staleAnchor: BoardViewportAnchor = {
      bucketId: "todo",
      occurrenceKey,
      issueId: "reef-005",
      offset: 9230,
      itemOffset: 584,
      focused: true,
    };
    const currentAnchor: BoardViewportAnchor = {
      ...staleAnchor,
      offset: 9814,
      itemOffset: 0,
    };
    const pendingFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      pendingFrames.set(id, callback);
      return id;
    });
    const cancelFrame = vi.fn((id: number) => {
      pendingFrames.delete(id);
    });
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);

    const { rerender } = renderColumn({
      bucket: statusBucket("todo"),
      continuityKey,
      issues,
    });
    const scrollElement = screen.getByTestId(
      "kanban-column-scroll-container",
    ) as HTMLElement;
    const targetCard = screen.getByRole("button", {
      name: "Issue reef-005",
    });
    vi.spyOn(scrollElement, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 320, 480),
    );
    let cardTop = 636;
    vi.spyOn(targetCard, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, cardTop, 320, 88),
    );
    scrollElement.scrollTop = 9278;
    targetCard.focus();

    rerender(
      <KanbanColumn
        bucket={statusBucket("todo")}
        continuityKey={continuityKey}
        issues={issues}
        restoreAnchor={staleAnchor}
      />,
    );

    expect(virtualizerProbe.scrollToIndex).toHaveBeenCalledWith(4, {
      align: "start",
    });
    expect(pendingFrames.size).toBe(1);

    scrollElement.scrollTop = currentAnchor.offset;
    cardTop = 100;
    rerender(
      <KanbanColumn
        bucket={statusBucket("todo")}
        continuityKey={continuityKey}
        issues={issues}
        restoreAnchor={currentAnchor}
      />,
    );

    expect(cancelFrame).toHaveBeenCalledWith(1);
    expect(pendingFrames.size).toBe(0);
    expect(virtualizerProbe.scrollToIndex).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(targetCard);
  });

  it("uses an independent serial baseline for quick-edit requests", () => {
    const issues = Array.from({ length: 10 }, (_, index) =>
      makeTestIssue(`reef-${String(index + 1).padStart(3, "0")}`),
    );
    useIssueKeyboardStore.setState({
      focusRequest: {
        scope: "board",
        issueId: "reef-001",
        occurrenceKey: "todo:reef-001",
        serial: 100,
      },
      quickEditRequest: {
        scope: "board",
        issueId: "reef-009",
        occurrenceKey: "todo:reef-009",
        field: "status",
        serial: 1,
      },
    });

    renderColumn({
      bucket: statusBucket("todo"),
      issues,
      focusRequestBaselineSerial: 100,
      quickEditRequestBaselineSerial: 0,
    });

    expect(virtualizerProbe.scrollToIndex).toHaveBeenCalledWith(8, {
      align: "auto",
    });
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
