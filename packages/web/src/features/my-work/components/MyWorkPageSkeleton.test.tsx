import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyWorkPageSkeleton, MyWorkSkeleton } from "./MyWorkPageSkeleton";

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
});
