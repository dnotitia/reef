import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanningPageSkeleton } from "./PlanningPageSkeleton";

describe("PlanningPageSkeleton", () => {
  it("paints the Planning chrome and row placeholders (REEF-255)", () => {
    render(<PlanningPageSkeleton />);

    expect(
      screen.getByRole("heading", { name: "Planning" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("planning-skeleton")).toBeInTheDocument();
    expect(
      screen.getByTestId("planning-skeleton-table-header").children,
    ).toHaveLength(6);
    for (const label of [
      "Sprints",
      "Milestones",
      "Releases",
      "Name",
      "Status",
      "Dates",
      "Issues",
      "Details",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("hides the decorative body and announces loading to assistive tech (REEF-281)", () => {
    const { container } = render(<PlanningPageSkeleton />);

    // Placeholder bars are decorative — aria-hidden individually — while the
    // fixed kind labels and table headers stay available.
    expect(
      container.querySelector('.reef-shimmer[aria-hidden="true"]'),
    ).not.toBeNull();
    expect(
      screen
        .getAllByText("Status")
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
