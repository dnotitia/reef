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
});
