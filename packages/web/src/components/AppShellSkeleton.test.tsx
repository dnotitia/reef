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
    expect(sidebar.querySelector(".reef-shimmer")).toHaveClass(
      "size-8",
      "md:w-28",
    );
    expect(main).toHaveClass("min-w-0", "overflow-hidden");
    expect(board).toHaveClass("min-w-0", "overflow-x-auto");
    expect(board.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
