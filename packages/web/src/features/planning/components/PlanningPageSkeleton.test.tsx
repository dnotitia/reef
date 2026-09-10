import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanningPageSkeleton } from "./PlanningPageSkeleton";

describe("PlanningPageSkeleton", () => {
  it("paints the Planning chrome and Overview placeholders (REEF-255)", () => {
    render(<PlanningPageSkeleton />);

    expect(
      screen.getByRole("heading", { name: "Planning" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("planning-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("planning-overview-loading")).toBeInTheDocument();
    for (const label of [
      "Overview",
      "List",
      "Current sprint",
      "Upcoming milestones",
      "Upcoming releases",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    const staticAction = screen.getByTestId("planning-static-new-action");
    expect(staticAction).toHaveAttribute("aria-hidden", "true");
    expect(staticAction.querySelector("button")).toBeNull();
    expect(staticAction).toHaveClass("h-7", "px-2.5", "type-small-button");
    expect(staticAction).not.toHaveClass("h-8");
  });

  it("hides the decorative body and announces loading to assistive tech (REEF-281)", () => {
    const { container } = render(<PlanningPageSkeleton />);

    // Placeholder bars are decorative while the fixed view labels stay
    // available.
    expect(
      container.querySelector('[aria-hidden="true"] .reef-shimmer'),
    ).not.toBeNull();
    expect(
      screen
        .getAllByText("Current sprint")
        .some((element) => element.closest('[aria-hidden="true"]') === null),
    ).toBe(true);

    // The role=status loading announcement is a sibling, not under aria-hidden,
    // and the real "Planning" h1 stays a heading.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading…");
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Planning" }),
    ).toBeInTheDocument();
  });
});
