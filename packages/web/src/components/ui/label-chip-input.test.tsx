import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LabelChipInput } from "./label-chip-input";

describe("LabelChipInput", () => {
  it("uses an explicit accessible name instead of relying on placeholder copy", () => {
    render(
      <LabelChipInput
        value={[]}
        onChange={vi.fn()}
        ariaLabel="Labels"
        placeholder="Filter labels"
        data-testid="labels-input"
      />,
    );

    expect(screen.getByLabelText("Labels")).toBe(
      screen.getByTestId("labels-input"),
    );
    expect(screen.getByTestId("labels-input")).toHaveAttribute(
      "placeholder",
      "Filter labels",
    );
  });

  it("truncates long chips and keeps the remove hit area at 20px", () => {
    const label = "very-long-label-that-should-not-push-the-filter-bar-wide";
    render(
      <LabelChipInput
        value={[label]}
        onChange={vi.fn()}
        ariaLabel="Labels"
        data-testid="labels-input"
      />,
    );

    const chipLabel = screen.getByText(label);
    expect(chipLabel).toHaveAttribute("title", label);
    expect(chipLabel.className).toContain("truncate");

    const remove = screen.getByRole("button", {
      name: `Remove label ${label}`,
    });
    expect(remove.className).toContain("h-5");
    expect(remove.className).toContain("w-5");
    expect(remove.querySelector("svg")?.className.baseVal).toContain("h-2.5");
  });
});
