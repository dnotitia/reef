import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MyWorkPageSkeleton, MyWorkSkeleton } from "./MyWorkPageSkeleton";

afterEach(cleanup);

describe("MyWorkPageSkeleton", () => {
  it("paints the My Work chrome around the body skeleton (REEF-255)", () => {
    render(<MyWorkPageSkeleton />);

    expect(
      screen.getByRole("heading", { name: "My Work" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("my-work-skeleton")).toBeInTheDocument();
  });

  it("exposes the body skeleton on its own for the page's in-flight branches", () => {
    render(<MyWorkSkeleton />);

    expect(screen.getByTestId("my-work-skeleton")).toBeInTheDocument();
  });

  it("reserves the StageBar and the queue header so the body does not shift on hydration (REEF-258)", () => {
    render(<MyWorkSkeleton />);
    const root = screen.getByTestId("my-work-skeleton");

    // StageBar: the status distribution bar (h-2) the old skeleton omitted.
    expect(root.querySelector(".reef-shimmer.h-2")).not.toBeNull();
    // Queue header: the By priority / By status group toggle (h-8 w-40).
    expect(root.querySelector(".reef-shimmer.h-8.w-40")).not.toBeNull();
    // Queue rows live in the same borderless-divider container as the real rows
    // (rounded-xl border), not a padded gap-2 box.
    expect(root.querySelector(".rounded-xl.border")).not.toBeNull();
  });

  it("matches the loaded tile count to sprint presence (REEF-258)", () => {
    const { rerender } = render(<MyWorkSkeleton />);
    let tiles = screen
      .getByTestId("my-work-skeleton")
      .querySelectorAll("ul > li");
    // No sprint → three tiles in a sm:grid-cols-3 grid.
    expect(tiles).toHaveLength(3);
    expect(
      screen
        .getByTestId("my-work-skeleton")
        .querySelector("ul.sm\\:grid-cols-3"),
    ).not.toBeNull();

    rerender(<MyWorkSkeleton hasSprint />);
    tiles = screen.getByTestId("my-work-skeleton").querySelectorAll("ul > li");
    // Sprint → four tiles in a sm:grid-cols-4 grid (adds the sprint tile).
    expect(tiles).toHaveLength(4);
    expect(
      screen
        .getByTestId("my-work-skeleton")
        .querySelector("ul.sm\\:grid-cols-4"),
    ).not.toBeNull();
  });

  it("carries one role=status announcement and hides the decorative body (REEF-281)", () => {
    const { container } = render(<MyWorkSkeleton />);

    // The stat/queue placeholders are decorative — aria-hidden so a screen
    // reader skips the empty DOM.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();

    // The role=status loading announcement is a sibling, not under aria-hidden.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading…");
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("announces loading exactly once on the full page — no nested duplicate (REEF-281)", () => {
    render(<MyWorkPageSkeleton />);

    // The announcement lives on the embedded MyWorkSkeleton leaf, so the
    // full-page skeleton surfaces exactly one — getByRole throws on a duplicate.
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    // The "My Work" h1 stays a real heading (PageHeader is not aria-hidden).
    expect(
      screen.getByRole("heading", { name: "My Work" }),
    ).toBeInTheDocument();
  });
});
