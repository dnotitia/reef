import type { IssueListItem } from "@reef/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Render probe: the column header renders exactly one StatusIcon per render, so
// counting StatusIcon invocations counts column-body renders. Cards are stubbed
// to null so the header's icon is counted. (REEF-097 AC1 lock-in)
const probe = vi.hoisted(() => ({ statusIconRenders: 0 }));
vi.mock("@/components/ui/status-icon", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/status-icon")>();
  return {
    ...actual,
    StatusIcon: () => {
      probe.statusIconRenders++;
      return null;
    },
  };
});

vi.mock("./KanbanCard", () => ({ KanbanCard: () => null }));

vi.mock("@dnd-kit/core", () => ({
  useDroppable: vi.fn(() => ({ setNodeRef: vi.fn(), isOver: false })),
}));

vi.mock("@formkit/auto-animate/react", () => ({
  useAutoAnimate: () => [vi.fn()],
}));

import { KanbanColumn } from "./KanbanColumn";

const makeIssue = (id: string): IssueListItem => ({
  id,
  title: `Issue ${id}`,
  status: "todo",
  created_at: "2026-04-13T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-04-13T00:00:00.000Z",
  updated_by: "alice",
});

const EMPTY_BLOCKED: ReadonlySet<string> = new Set();
const NOOP = () => {};

afterEach(() => {
  cleanup();
  probe.statusIconRenders = 0;
});

function Harness({ issues }: { issues: IssueListItem[] }) {
  const [tick, force] = useReducer((x: number) => x + 1, 0);
  return (
    <div>
      <button type="button" data-testid="force" onClick={force}>
        {tick}
      </button>
      <KanbanColumn
        status="todo"
        issues={issues}
        blockedIds={EMPTY_BLOCKED}
        onIssueClick={NOOP}
      />
    </div>
  );
}

describe("KanbanColumn memo (REEF-097)", () => {
  it("does not re-render an unchanged column when the parent re-renders", () => {
    const issues = [makeIssue("reef-001")];
    render(<Harness issues={issues} />);
    expect(probe.statusIconRenders).toBe(1);

    fireEvent.click(screen.getByTestId("force"));
    fireEvent.click(screen.getByTestId("force"));

    // status / issues / blockedIds / onIssueClick refs are all unchanged, so
    // memo skips the column on each parent re-render.
    expect(probe.statusIconRenders).toBe(1);
  });

  it("re-renders the column only when its issue list actually changes", () => {
    const { rerender } = render(<Harness issues={[makeIssue("reef-001")]} />);
    expect(probe.statusIconRenders).toBe(1);

    rerender(
      <Harness issues={[makeIssue("reef-001"), makeIssue("reef-002")]} />,
    );
    expect(probe.statusIconRenders).toBe(2);
  });
});
