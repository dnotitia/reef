import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { IssueListItem } from "@reef/core";
import { render, screen } from "@testing-library/react";
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

function renderRow() {
  return render(
    <IntlTestProvider>
      <table>
        <tbody>
          <BacklogRow
            issue={issue}
            href="/workspace/reef-acme/issues/REEF-007?view=backlog"
            logicalIds={[issue.id]}
            onOpen={vi.fn()}
            onStatusChange={vi.fn()}
            reorderHint="Drag to reorder in Rank order"
            sortable
          />
        </tbody>
      </table>
    </IntlTestProvider>,
  );
}

describe("BacklogRow", () => {
  afterEach(() => {
    useIssueSelectionStore.getState().clearForContextChange();
    useIssueKeyboardStore.setState({
      visibleIssueIds: { list: [], board: [], backlog: [] },
      focusedIssueId: { list: null, board: null, backlog: null },
      tabStopIssueId: { list: null, board: null, backlog: null },
      focusRequest: null,
      quickEditRequest: null,
    });
  });

  it("keeps issue links and interactive controls independently addressable", () => {
    renderRow();

    expect(screen.getByRole("link", { name: "REEF-007" })).toHaveAttribute(
      "href",
      "/workspace/reef-acme/issues/REEF-007?view=backlog",
    );
    expect(screen.getByRole("link", { name: "Deferred row" })).toHaveAttribute(
      "href",
      "/workspace/reef-acme/issues/REEF-007?view=backlog",
    );
    expect(screen.getByTestId("backlog-grip-REEF-007")).toHaveAttribute(
      "aria-label",
      "Reorder REEF-007",
    );
    expect(
      screen.getByTestId("backlog-status-select-REEF-007"),
    ).toHaveAttribute("aria-label", "Change REEF-007 status");
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
});
