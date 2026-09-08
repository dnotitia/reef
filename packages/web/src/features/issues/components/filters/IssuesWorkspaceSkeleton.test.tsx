import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IssuesWorkspaceSkeleton } from "./IssuesWorkspaceSkeleton";

describe("IssuesWorkspaceSkeleton", () => {
  it("paints the issues chrome and a board-column frame (REEF-255)", () => {
    render(<IssuesWorkspaceSkeleton />);

    // Not a blank body: the skeleton root, the page title, and the board column
    // placeholders are all present so a hard-nav first paint reads as "loading
    // the board".
    expect(screen.getByTestId("issues-skeleton")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Issues" })).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Issue scope" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Issue view" }),
    ).toBeInTheDocument();
    for (const label of ["Status", "Type", "Priority", "Assignee", "Labels"]) {
      if (label === "Labels") {
        expect(screen.getByPlaceholderText(label)).toBeInTheDocument();
      } else {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
    }
    expect(screen.getByTestId("issues-skeleton")).toHaveClass("min-w-0");
    expect(screen.getByTestId("board-columns-skeleton")).toHaveClass(
      "min-w-0",
      "overflow-x-hidden",
      "overflow-y-auto",
    );
  });

  it("reserves the toolbar's two rows so it does not grow on hydration (REEF-258)", () => {
    const { container } = render(<IssuesWorkspaceSkeleton />);

    // The real IssueFilterToolbar is a SearchBar row (h-9) over a wrapping
    // FilterBar row; the old single-row skeleton (3 chips) let the toolbar grow
    // ~50–90px and shove the board down when it hydrated.
    const toolbar = screen.getByTestId("issues-skeleton-toolbar");
    expect(toolbar).toBeInTheDocument();

    // SearchBar chrome: a full-width h-9 static label.
    const searchRow = toolbar.querySelector("[data-testid=search-bar] input");
    expect(searchRow).not.toBeNull();
    expect(searchRow).toHaveAttribute("placeholder", "Search issues...");

    // FilterBar chrome: one static control per facet/value group including the
    // single compound updated-at trigger, sort, and My Views (16 controls).
    const chips = toolbar.querySelectorAll("[data-fixed-filter]");
    expect(chips).toHaveLength(16);
    expect(
      toolbar.querySelectorAll('.reef-shimmer[aria-hidden="true"]'),
    ).toHaveLength(0);
    // The whole chip group sits in a single flex-wrap container so it wraps to
    // the same row count as the live FilterBar.
    expect(container.querySelector(".flex.flex-wrap")).not.toBeNull();
  });

  it("reflects the issue scope and view from the URL", () => {
    render(<IssuesWorkspaceSkeleton searchParams="scope=backlog&view=list" />);

    expect(screen.getByTestId("scope-switcher-backlog")).toHaveClass(
      "bg-surface-hover",
    );
    expect(screen.getByTestId("scope-switcher-active")).toHaveClass(
      "text-muted-foreground",
    );
    expect(screen.getByTestId("view-switcher-list")).toHaveClass(
      "bg-surface-hover",
    );
    expect(screen.getByTestId("view-switcher-board")).toHaveClass(
      "text-muted-foreground",
    );
  });

  it.each(["list", "timeline"] as const)(
    "uses a %s body frame for the selected URL view",
    (layout) => {
      render(<IssuesWorkspaceSkeleton searchParams={`view=${layout}`} />);

      expect(
        screen.getByTestId(`issues-${layout}-skeleton`),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("board-columns-skeleton")).toBeNull();
    },
  );

  it("hides the decorative body and announces loading to assistive tech (REEF-281)", () => {
    const { container } = render(<IssuesWorkspaceSkeleton />);

    // Placeholder bars are decorative — aria-hidden individually — while the
    // fixed toolbar labels and board headings stay available.
    expect(
      container.querySelector('.reef-shimmer[aria-hidden="true"]'),
    ).not.toBeNull();
    expect(
      screen
        .getByTestId("issues-skeleton-toolbar")
        .closest('[aria-hidden="true"]'),
    ).toBeNull();

    // The role=status loading announcement is still heard, and the real
    // "Issues" h1 stays a heading (not inside aria-hidden).
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading…");
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByRole("heading", { name: "Issues" })).toBeInTheDocument();
  });
});
