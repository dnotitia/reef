import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import type { IssueListItem, PlanningCatalog } from "@reef/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KanbanCard } from "./KanbanCard";

// The card reads the signed-in login to decide whether the assignee avatar is
// "you" (brand tone). Mock it directly: KanbanCard renders without a
// QueryClient in these tests, and the real hook is backed by useQuery.
const currentLogin = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("@/features/auth/hooks/useCurrentUserLogin", () => ({
  useCurrentUserLogin: () => currentLogin.value,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  currentLogin.value = null;
  useIssueKeyboardStore.setState({
    visibleIssueIds: { list: [], board: [] },
    focusedIssueId: { list: null, board: null },
    tabStopIssueId: { list: null, board: null },
    focusRequest: null,
    quickEditRequest: null,
  });
});

// Mock @dnd-kit/core to avoid JSDOM drag issues
vi.mock("@dnd-kit/core", () => ({
  useDraggable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  })),
}));

// Mock @dnd-kit/utilities
vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Translate: {
      toString: (t: { x: number; y: number } | null) =>
        t ? `translate3d(${t.x}px, ${t.y}px, 0)` : "",
    },
  },
}));

import { useDraggable } from "@dnd-kit/core";

const mockIssue = (overrides: Partial<IssueListItem> = {}): IssueListItem => ({
  id: "reef-001",
  title: "Fix login bug",
  status: "todo",
  created_at: "2026-04-13T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-04-13T00:00:00.000Z",
  updated_by: "alice",
  ...overrides,
});

const planningCatalog: PlanningCatalog = {
  sprints: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Sprint 3 - 0.5.0 Activity, Reports & Platform Polish",
      status: "active",
      start_date: "2026-06-12",
      end_date: "2026-06-19",
      goal: "",
      capacity_points: null,
    },
  ],
  milestones: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Issue Management Experience & Querying",
      status: "open",
      target_date: null,
      description: "",
    },
  ],
  releases: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "v0.5.0 - Activity, Reports & Platform Polish",
      status: "in_progress",
      target_date: "2026-06-19",
      released_at: null,
      notes: "",
    },
  ],
};

describe("KanbanCard", () => {
  it("renders issue title and id", () => {
    render(<KanbanCard issue={mockIssue()} />);
    expect(screen.getByText("Fix login bug")).toBeDefined();
    expect(screen.getByText("reef-001")).toBeDefined();
  });

  it("renders priority badge when priority is present", () => {
    render(<KanbanCard issue={mockIssue({ priority: "high" })} />);
    // The card shows the locale-resolved priority label (REEF-292), not the raw
    // enum value; tests resolve to the en base via the global fieldLabels mock.
    expect(screen.getByText("High")).toBeDefined();
  });

  it("omits priority badge when priority is undefined", () => {
    render(<KanbanCard issue={mockIssue({ priority: undefined })} />);
    expect(screen.queryByText("High")).toBeNull();
    expect(screen.queryByText("medium")).toBeNull();
  });

  it("renders sprint, milestone, and release in a left-aligned compact glyph-marked planning strip (REEF-232 follow-up)", () => {
    render(
      <KanbanCard
        issue={mockIssue({
          sprint_id: planningCatalog.sprints[0]?.id,
          milestone_id: planningCatalog.milestones[0]?.id,
          release_id: planningCatalog.releases[0]?.id,
        })}
        planningCatalog={planningCatalog}
      />,
    );

    // A compact footer list set off by a hairline: every item shares the same
    // fixed glyph column and value column so wrapped cards do not drift left.
    const strip = screen.getByTestId("kanban-planning-context");
    expect(strip.className).toContain("min-w-0");
    expect(strip.className).toContain("grid");
    expect(strip.className).toContain("gap-0.5");
    expect(strip.className).toContain("border-t");

    const sprint = screen.getByLabelText(
      "Sprint: Sprint 3 - 0.5.0 Activity, Reports & Platform Polish",
    );
    const milestone = screen.getByLabelText(
      "Milestone: Issue Management Experience & Querying",
    );
    const release = screen.getByLabelText(
      "Release: v0.5.0 - Activity, Reports & Platform Polish",
    );

    // data-planning-kind is the canonical catalog key (plural).
    expect(sprint.getAttribute("data-planning-kind")).toBe("sprints");
    expect(milestone.getAttribute("data-planning-kind")).toBe("milestones");
    expect(release.getAttribute("data-planning-kind")).toBe("releases");

    for (const [item, label] of [
      [sprint, "Sprint"],
      [milestone, "Milestone"],
      [release, "Release"],
    ] as const) {
      // The kind is carried by a decorative glyph (svg), not a boxed word —
      // the old bordered label token (the label word rendered alone) is gone.
      const glyph = (item as HTMLElement).querySelector("svg");
      expect(glyph).not.toBeNull();
      expect(glyph?.getAttribute("aria-hidden")).toBe("true");
      expect((item as HTMLElement).className).toContain("grid-cols-");
      expect(within(item as HTMLElement).queryByText(label)).toBeNull();
      expect((item as HTMLElement).innerHTML).not.toContain(
        "border-border-subtle",
      );
      expect((item as HTMLElement).innerHTML).not.toContain("rounded-[3px]");

      const name = item.getAttribute("title")?.replace(`${label}: `, "") ?? "";
      const textLane = within(item as HTMLElement).getByText(name);
      expect(textLane.className).toContain("min-w-0");
      expect(textLane.className).toContain("truncate");
    }
  });

  it("does not render the planning strip when no planning names resolve", () => {
    render(
      <KanbanCard
        issue={mockIssue({
          sprint_id: "missing-sprint",
          milestone_id: "missing-milestone",
          release_id: "missing-release",
        })}
        planningCatalog={planningCatalog}
      />,
    );

    expect(screen.queryByTestId("kanban-planning-context")).toBeNull();
  });

  it("applies dragging style class when isDragging is true", () => {
    vi.mocked(useDraggable).mockReturnValueOnce({
      attributes: {
        role: "button",
        tabIndex: 0,
        "aria-disabled": false,
        "aria-pressed": undefined,
        "aria-roledescription": "draggable",
        "aria-describedby": "DndDescribedBy-0",
      },
      listeners: {},
      setNodeRef: vi.fn(),
      setActivatorNodeRef: vi.fn(),
      activeNodeRect: null,
      transform: { x: 10, y: 20, scaleX: 1, scaleY: 1 },
      isDragging: true,
      node: { current: null },
      over: null,
      active: null,
      activatorEvent: null,
    });

    const { container } = render(<KanbanCard issue={mockIssue()} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("opacity-50");
    expect(card.className).toContain("cursor-grabbing");
  });

  it("does not apply dragging class when not dragging", () => {
    const { container } = render(<KanbanCard issue={mockIssue()} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).not.toContain("opacity-50");
  });

  it("keeps keyboard focus chrome inset so column overflow cannot clip rounded card corners", () => {
    useIssueKeyboardStore.setState({
      focusedIssueId: { list: null, board: "reef-001" },
      tabStopIssueId: { list: null, board: "reef-001" },
    });

    render(<KanbanCard issue={mockIssue()} />);

    const card = screen.getByTestId("kanban-card");
    expect(card).toHaveAttribute("data-keyboard-focused", "true");
    expect(card.className).toContain("focus-visible:ring-inset");
    expect(card.className).toContain("focus-visible:border-brand");
    expect(card.className).toContain("ring-inset");
    expect(card.className).toContain("ring-brand/30");
    expect(card.className).toContain("bg-brand/5");
    expect(card.className).not.toContain("ring-offset");
  });

  it("renders the assignee as an identifiable avatar when present", () => {
    render(<KanbanCard issue={mockIssue({ assigned_to: "bob" })} />);
    // Board cards show the avatar alone (login monogram + tooltip), not "@login".
    const avatar = screen.getByRole("img", { name: "bob" });
    expect(avatar).toHaveTextContent("BO");
    expect(screen.queryByText("@bob")).toBeNull();
  });

  it("pins the assignee avatar to a flush-right slot regardless of other meta", () => {
    // The avatar should be the last child of the ml-auto trailing group so it
    // lands at the same x on every card, whether or not priority/dates are
    // present (REEF-128). The old layout packed it right after priority, so its
    // x drifted with the priority pill's presence.
    const { unmount } = render(
      <KanbanCard
        issue={mockIssue({
          priority: "high",
          start_date: "2026-06-01",
          due_date: "2026-06-09",
          assigned_to: "bob",
        })}
      />,
    );
    let avatar = screen.getByRole("img", { name: "bob" });
    let slot = avatar.parentElement as HTMLElement;
    expect(slot.className).toContain("ml-auto");
    expect(slot.lastElementChild).toBe(avatar);
    unmount();

    // With no priority and no dates, the avatar is still pinned right.
    render(<KanbanCard issue={mockIssue({ assigned_to: "bob" })} />);
    avatar = screen.getByRole("img", { name: "bob" });
    slot = avatar.parentElement as HTMLElement;
    expect(slot.className).toContain("ml-auto");
    expect(slot.lastElementChild).toBe(avatar);
  });

  it("paints the current user's own assignee avatar with the brand tone (REEF-173)", () => {
    currentLogin.value = "bob";
    render(<KanbanCard issue={mockIssue({ assigned_to: "bob" })} />);
    const avatar = screen.getByRole("img", { name: "bob" });
    expect(avatar.className).toContain("bg-brand");
    expect(/\bbg-av-\d\b/.test(avatar.className)).toBe(false);
  });

  it("keeps another user's assignee avatar on the hashed identity tone", () => {
    currentLogin.value = "alice";
    render(<KanbanCard issue={mockIssue({ assigned_to: "bob" })} />);
    const avatar = screen.getByRole("img", { name: "bob" });
    expect(/\bbg-av-\d\b/.test(avatar.className)).toBe(true);
    expect(avatar.className).not.toContain("bg-brand");
  });

  it("invokes onClick with the issue id when clicked", () => {
    const onClick = vi.fn();
    render(<KanbanCard issue={mockIssue()} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("kanban-card"));
    expect(onClick).toHaveBeenCalledWith("reef-001");
  });

  it("ignores click while dragging", () => {
    vi.mocked(useDraggable).mockReturnValueOnce({
      attributes: {
        role: "button",
        tabIndex: 0,
        "aria-disabled": false,
        "aria-pressed": undefined,
        "aria-roledescription": "draggable",
        "aria-describedby": "DndDescribedBy-0",
      },
      listeners: {},
      setNodeRef: vi.fn(),
      setActivatorNodeRef: vi.fn(),
      activeNodeRect: null,
      transform: null,
      isDragging: true,
      node: { current: null },
      over: null,
      active: null,
      activatorEvent: null,
    });
    const onClick = vi.fn();
    render(<KanbanCard issue={mockIssue()} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("kanban-card"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("activates onClick from the keyboard (Enter)", () => {
    const onClick = vi.fn();
    render(<KanbanCard issue={mockIssue()} onClick={onClick} />);
    fireEvent.keyDown(screen.getByTestId("kanban-card"), { key: "Enter" });
    expect(onClick).toHaveBeenCalledWith("reef-001");
  });

  it("marks active past-due issues as overdue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T00:00:00.000Z"));

    render(<KanbanCard issue={mockIssue({ due_date: "2026-06-01" })} />);

    expect(screen.getByTitle("Due 2026-06-01").className).toContain(
      "text-destructive",
    );
  });

  it("does not mark done or closed past-due issues as overdue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T00:00:00.000Z"));

    for (const status of ["done", "closed"] as const) {
      const { unmount } = render(
        <KanbanCard issue={mockIssue({ status, due_date: "2026-06-01" })} />,
      );

      expect(screen.getByTitle("Due 2026-06-01").className).not.toContain(
        "text-destructive",
      );
      unmount();
    }
  });
});
