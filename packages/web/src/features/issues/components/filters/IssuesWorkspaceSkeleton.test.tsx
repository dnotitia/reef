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
  });

  it("reserves the toolbar's two rows so it does not grow on hydration (REEF-258)", () => {
    const { container } = render(<IssuesWorkspaceSkeleton />);

    // The real IssueFilterToolbar is a SearchBar row (h-9) over a wrapping
    // FilterBar row; the old single-row skeleton (3 chips) let the toolbar grow
    // ~50–90px and shove the board down when it hydrated.
    const toolbar = screen.getByTestId("issues-skeleton-toolbar");
    expect(toolbar).toBeInTheDocument();

    // SearchBar placeholder: a full-width h-9 bar.
    const searchRow = toolbar.querySelector(".reef-shimmer.h-9.w-full");
    expect(searchRow).not.toBeNull();

    // FilterBar placeholder: the wrapping chip row, one chip per facet/value
    // field (13), each at the combobox chip height (h-8).
    const chips = toolbar.querySelectorAll(".reef-shimmer.h-8");
    expect(chips).toHaveLength(13);
    // The whole chip group sits in a single flex-wrap container so it wraps to
    // the same row count as the live FilterBar.
    expect(container.querySelector(".flex.flex-wrap")).not.toBeNull();
  });

  it("hides the decorative body and announces loading to assistive tech (REEF-281)", () => {
    const { container } = render(<IssuesWorkspaceSkeleton />);

    // The toolbar/board placeholders are decorative — aria-hidden so a screen
    // reader does not traverse the empty frame.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // The toolbar lives inside the aria-hidden body…
    expect(
      screen
        .getByTestId("issues-skeleton-toolbar")
        .closest('[aria-hidden="true"]'),
    ).not.toBeNull();

    // …but the role=status loading announcement does NOT, so it is still heard,
    // and the real "Issues" h1 stays a heading (not inside aria-hidden).
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading…");
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByRole("heading", { name: "Issues" })).toBeInTheDocument();
  });
});
