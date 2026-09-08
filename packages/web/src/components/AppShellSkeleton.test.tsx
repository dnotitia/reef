import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShellSkeleton } from "./AppShellSkeleton";

describe("AppShellSkeleton", () => {
  it("keeps the loading rail and board frame on the live shell width contract", () => {
    render(
      <IntlTestProvider>
        <AppShellSkeleton />
      </IntlTestProvider>,
    );

    const sidebar = screen.getByTestId("app-shell-skeleton-sidebar");
    const main = screen.getByTestId("app-shell-skeleton-main");
    const board = screen.getByTestId("board-columns-skeleton");

    expect(sidebar).toHaveClass("w-14", "md:w-60", "shrink-0");
    expect(sidebar.querySelector(".reef-shimmer")).toBeNull();
    expect(main).toHaveClass("min-w-0", "overflow-hidden");
    expect(board).toHaveClass("min-w-0", "overflow-x-auto");
    expect(
      board.querySelector('.reef-shimmer[aria-hidden="true"]'),
    ).not.toBeNull();
    expect(screen.getByText("reef")).toBeInTheDocument();
    for (const label of [
      "New issue",
      "Issues",
      "My Work",
      "Inbox",
      "Planning",
      "Reports",
      "Settings",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
