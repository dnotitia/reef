import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { useFlashStore } from "@/features/issues/stores/useFlashStore";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { IssueListItem } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BacklogRow } from "./BacklogRow";

vi.mock("@/features/auth/hooks/useCurrentUserLogin", () => ({
  useCurrentUserLogin: () => null,
}));

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const issue: IssueListItem = {
  id: "REEF-007",
  title: "Deferred row",
  status: "backlog",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
};

function renderRow(
  onOpen: (id: string) => void = vi.fn(),
  reorderState?: "pending" | "error",
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlTestProvider>
        <table>
          <tbody>
            <BacklogRow
              issue={issue}
              vault="reef-acme"
              href="/workspace/reef-acme/issues/REEF-007?scope=backlog&view=list"
              logicalIds={[issue.id]}
              onOpen={onOpen}
              reorderHint="Drag to reorder in Rank order"
              reorderState={reorderState}
              sortable
            />
          </tbody>
        </table>
      </IntlTestProvider>
    </QueryClientProvider>,
  );
}

describe("BacklogRow", () => {
  afterEach(() => {
    cleanup();
    useIssueSelectionStore.getState().clearForContextChange();
    useIssueKeyboardStore.setState({
      visibleIssueIds: { list: [], board: [], backlog: [] },
      visibleOccurrences: { list: [], board: [], backlog: [] },
      focusedIssueId: { list: null, board: null, backlog: null },
      focusedOccurrenceKey: { list: null, board: null, backlog: null },
      tabStopIssueId: { list: null, board: null, backlog: null },
      tabStopOccurrenceKey: { list: null, board: null, backlog: null },
      focusRequest: null,
      quickEditRequest: null,
    });
    useFlashStore.setState({
      flashedIssueKeys: new Set(),
      reorderFlashedIssueKeys: new Set(),
    });
  });

  it("keeps issue links and interactive controls independently addressable", () => {
    renderRow();

    expect(screen.getByRole("link", { name: "REEF-007" })).toHaveAttribute(
      "href",
      "/workspace/reef-acme/issues/REEF-007?scope=backlog&view=list",
    );
    expect(screen.getByRole("link", { name: "Deferred row" })).toHaveAttribute(
      "href",
      "/workspace/reef-acme/issues/REEF-007?scope=backlog&view=list",
    );
    expect(screen.getByTestId("backlog-grip-REEF-007")).toHaveAttribute(
      "aria-label",
      "Reorder REEF-007",
    );
    expect(screen.getByTestId("issue-inline-edit-status")).toHaveAttribute(
      "aria-label",
      "Status",
    );
  });

  it.each([
    ["pending", "Saving position"],
    ["error", "Position not saved"],
  ] as const)("keeps reorder %s state on the row", (state, label) => {
    renderRow(vi.fn(), state);

    const row = screen.getByTestId("backlog-row");
    expect(row).toHaveAttribute("data-reorder-state", state);
    if (state === "pending") expect(row).toHaveAttribute("aria-busy", "true");
    else expect(row).not.toHaveAttribute("aria-busy");
    expect(screen.getByTestId("issue-reorder-status")).toHaveAttribute(
      "aria-label",
      label,
    );
  });

  it("marks a canonical reorder success with the existing flash pulse", () => {
    useFlashStore.getState().flashIssue("reef-acme", issue.id, "reorder");

    renderRow();

    const row = screen.getByTestId("backlog-row");
    expect(row).toHaveAttribute("data-reorder-state", "success");
    expect(row).toHaveClass("reef-flash-row", "reef-reorder-success-row");
  });

  it("toggles selection without opening the row", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole("checkbox", { name: "Select REEF-007" }));

    expect(useIssueSelectionStore.getState().selectedIds).toEqual(
      new Set(["REEF-007"]),
    );
    expect(screen.getByTestId("backlog-row")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it.each(["Enter", " "])(
    "opens the row with %s without relying on the global shortcut",
    (key) => {
      const onOpen = vi.fn();
      renderRow(onOpen);

      fireEvent.keyDown(screen.getByTestId("backlog-row"), { key });

      expect(onOpen).toHaveBeenCalledWith("REEF-007");
    },
  );

  it("leaves links and triage controls to their native keyboard behavior", () => {
    const onOpen = vi.fn();
    renderRow(onOpen);

    fireEvent.keyDown(screen.getByRole("link", { name: "REEF-007" }), {
      key: "Enter",
    });
    fireEvent.keyDown(screen.getByTestId("issue-inline-edit-status"), {
      key: " ",
    });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the shared quick editor from every triage field without opening detail", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();

    useIssueKeyboardStore
      .getState()
      .setVisibleOccurrences("backlog", [{ key: issue.id, issueId: issue.id }]);
    renderRow(onOpen);

    for (const field of ["status", "priority", "assignee"] as const) {
      await user.click(screen.getByTestId(`issue-inline-edit-${field}`));
      expect(useIssueKeyboardStore.getState().quickEditRequest).toMatchObject({
        scope: "backlog",
        issueId: issue.id,
        occurrenceKey: issue.id,
        field,
      });
      expect(screen.getByTestId("issue-quick-edit-anchor")).toBeVisible();
      expect(onOpen).not.toHaveBeenCalled();
      useIssueKeyboardStore.getState().closeQuickEdit();
    }
  });

  it("opens each triage editor from Enter without opening detail", () => {
    const onOpen = vi.fn();

    for (const field of ["status", "priority", "assignee"] as const) {
      cleanup();
      useIssueKeyboardStore
        .getState()
        .setVisibleOccurrences("backlog", [
          { key: issue.id, issueId: issue.id },
        ]);
      renderRow(onOpen);

      fireEvent.keyDown(screen.getByTestId(`issue-inline-edit-${field}`), {
        key: "Enter",
      });

      expect(useIssueKeyboardStore.getState().quickEditRequest).toMatchObject({
        scope: "backlog",
        issueId: issue.id,
        occurrenceKey: issue.id,
        field,
      });
      expect(onOpen).not.toHaveBeenCalled();
      useIssueKeyboardStore.getState().closeQuickEdit();
    }
  });

  it("positions the shared editor beside the activated backlog field", async () => {
    useIssueKeyboardStore
      .getState()
      .setVisibleOccurrences("backlog", [{ key: issue.id, issueId: issue.id }]);
    renderRow();

    const trigger = screen.getByTestId("issue-inline-edit-priority");
    Object.defineProperty(trigger, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 460,
        top: 80,
        width: 88,
        height: 28,
        right: 548,
        bottom: 108,
        x: 460,
        y: 80,
        toJSON: () => ({}),
      }),
    });

    await userEvent.setup().click(trigger);

    await waitFor(() =>
      expect(screen.getByTestId("issue-quick-edit-anchor")).toHaveStyle({
        left: "460px",
        top: "94px",
      }),
    );
    useIssueKeyboardStore.getState().closeQuickEdit();
  });

  it("keeps the narrow Priority quick editor inside the viewport", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 640,
    });

    try {
      useIssueKeyboardStore
        .getState()
        .setVisibleOccurrences("backlog", [
          { key: issue.id, issueId: issue.id },
        ]);
      renderRow();

      const trigger = screen.getByTestId("issue-inline-edit-priority");
      Object.defineProperty(trigger, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          left: 500,
          top: 80,
          width: 88,
          height: 28,
          right: 588,
          bottom: 108,
          x: 500,
          y: 80,
          toJSON: () => ({}),
        }),
      });

      await userEvent.setup().click(trigger);

      const anchor = screen.getByTestId("issue-quick-edit-anchor");
      expect(Number.parseFloat(anchor.style.left)).toBeLessThanOrEqual(448);
      expect(Number.parseFloat(anchor.style.left)).toBeGreaterThanOrEqual(0);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("uses compact enum chrome while keeping the assignee anchor width", async () => {
    const user = userEvent.setup();

    for (const field of ["status", "priority", "assignee"] as const) {
      cleanup();
      useIssueKeyboardStore
        .getState()
        .setVisibleOccurrences("backlog", [
          { key: issue.id, issueId: issue.id },
        ]);
      renderRow();

      await user.click(screen.getByTestId(`issue-inline-edit-${field}`));

      const anchor = screen.getByTestId("issue-quick-edit-anchor");
      expect(anchor).toHaveClass(field === "assignee" ? "w-56" : "w-48");

      if (field !== "assignee") {
        expect(screen.getByRole("listbox")).toHaveClass("w-48");
      }

      useIssueKeyboardStore.getState().closeQuickEdit();
    }
  });

  it("does not expose labels or planning quick-edit controls", () => {
    renderRow();

    expect(screen.queryByTestId("issue-inline-edit-labels")).toBeNull();
    expect(screen.queryByTestId("issue-inline-edit-sprint")).toBeNull();
    expect(screen.queryByTestId("issue-inline-edit-release")).toBeNull();
  });

  it("ignores a stale Backlog Labels request instead of rendering a hidden editor", () => {
    useIssueKeyboardStore
      .getState()
      .setVisibleOccurrences("backlog", [{ key: issue.id, issueId: issue.id }]);
    renderRow();

    act(() => {
      useIssueKeyboardStore.getState().requestQuickEdit("backlog", "labels");
    });

    expect(screen.queryByTestId("issue-quick-edit-anchor")).toBeNull();
  });
});
