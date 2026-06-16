import type { IssueListItem } from "@reef/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Render probe: the card renders exactly one StatusIcon per render, so counting
// StatusIcon invocations counts card-body renders. When `memo` skips an
// unchanged card, StatusIcon is does not re-invoked. (REEF-097 AC1 lock-in)
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

vi.mock("@/features/auth/hooks/useCurrentUserLogin", () => ({
  useCurrentUserLogin: () => null,
}));

vi.mock("@dnd-kit/core", () => ({
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

import { KanbanCard } from "./KanbanCard";

const ISSUE: IssueListItem = {
  id: "reef-001",
  title: "Fix login bug",
  status: "todo",
  created_at: "2026-04-13T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-04-13T00:00:00.000Z",
  updated_by: "alice",
};

const NOOP = () => {};

afterEach(() => {
  cleanup();
  probe.statusIconRenders = 0;
});

// A parent that can re-render on demand while passing the card stable props.
function Harness({ blocked }: { blocked: boolean }) {
  const [tick, force] = useReducer((x: number) => x + 1, 0);
  return (
    <div>
      <button type="button" data-testid="force" onClick={force}>
        {tick}
      </button>
      <KanbanCard issue={ISSUE} blocked={blocked} onClick={NOOP} />
    </div>
  );
}

describe("KanbanCard memo (REEF-097)", () => {
  it("does not re-render an unchanged card when the parent re-renders", () => {
    render(<Harness blocked={false} />);
    expect(probe.statusIconRenders).toBe(1);

    fireEvent.click(screen.getByTestId("force"));
    fireEvent.click(screen.getByTestId("force"));

    // Card props (issue / blocked / onClick refs) are unchanged across both
    // parent re-renders, so memo skips the card every time.
    expect(probe.statusIconRenders).toBe(1);
  });

  it("re-renders the card only when its blocked state actually changes", () => {
    const { rerender } = render(<Harness blocked={false} />);
    expect(probe.statusIconRenders).toBe(1);

    rerender(<Harness blocked={true} />);
    expect(probe.statusIconRenders).toBe(2);
  });
});
