import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { IssueViewLoading } from "./IssueViewLoading";

function renderLoading(ui: ReactNode) {
  return render(<IntlTestProvider>{ui}</IntlTestProvider>);
}

describe("IssueViewLoading", () => {
  it("keeps the board's column and card structure while its code loads", () => {
    renderLoading(<IssueViewLoading name="board" />);

    expect(screen.getByTestId("issues-board-loading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByTestId("board-columns-skeleton")).toBeInTheDocument();
    expect(screen.getAllByTestId("kanban-group-header").length).toBeGreaterThan(
      1,
    );
  });

  it("shows a table header and rows for the list loading frame", () => {
    renderLoading(<IssueViewLoading name="list" />);

    const table = screen.getByTestId("issues-list-table-skeleton");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(9);
    expect(within(table).getAllByTestId("skeleton-row")).toHaveLength(8);
  });

  it("shows the backlog table frame while its code loads", () => {
    renderLoading(<IssueViewLoading name="backlog" />);

    expect(screen.getByTestId("backlog-table-skeleton")).toBeInTheDocument();
    expect(
      screen.getByTestId("backlog-table-skeleton").querySelectorAll("tbody tr"),
    ).toHaveLength(6);
  });

  it("shows a timeline grid frame while its code loads", () => {
    renderLoading(<IssueViewLoading name="timeline" />);

    expect(screen.getByTestId("timeline-grid-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-view-skeleton")).toHaveClass("flex-1");
    expect(
      screen
        .getByTestId("timeline-grid-skeleton")
        .querySelectorAll(".reef-shimmer"),
    ).toHaveLength(5);
  });

  it("keeps the retryable chunk failure state", () => {
    const retry = vi.fn();
    renderLoading(
      <IssueViewLoading
        name="list"
        error={new Error("chunk failed")}
        retry={retry}
      />,
    );

    expect(screen.getByTestId("issues-list-loading")).toHaveAttribute(
      "role",
      "alert",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("issues-list-table-skeleton")).toBeNull();
  });
});
