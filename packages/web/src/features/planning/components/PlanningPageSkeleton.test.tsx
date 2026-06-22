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
  });

  it("hides the decorative body and announces loading to assistive tech (REEF-281)", () => {
    const { container } = render(<PlanningPageSkeleton />);

    // The kind-toggle + table placeholders are decorative — aria-hidden so a
    // screen reader skips them.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();

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
