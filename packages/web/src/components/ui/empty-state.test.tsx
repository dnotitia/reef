import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders the canonical section frame and semantic slots", () => {
    render(
      <EmptyState
        data-testid="section-empty"
        title="No issues yet"
        description="Create an issue to begin."
        action={<button type="button">Create issue</button>}
      />,
    );

    const state = screen.getByTestId("section-empty");
    expect(state).toHaveAttribute("data-slot", "empty-state");
    expect(state.className).toContain("rounded-lg");
    expect(state.className).toContain("border-dashed");
    expect(state.className).toContain("border-border-subtle");
    expect(state.className).toContain("bg-surface-subtle");
    expect(state.className).toContain("px-6");
    expect(state.className).toContain("py-12");
    expect(
      screen.getByRole("heading", { name: "No issues yet" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Create an issue to begin.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create issue" }),
    ).toBeInTheDocument();
  });

  it("keeps the structure variant unboxed and centered", () => {
    render(
      <EmptyState
        variant="structure"
        data-testid="structure-empty"
        description="Pick a workspace to continue."
      />,
    );

    const state = screen.getByTestId("structure-empty");
    expect(state.className).toContain("flex-1");
    expect(state.className).toContain("items-center");
    expect(state.className).not.toContain("rounded-lg");
    expect(state.className).not.toContain("border-dashed");
    expect(state.className).not.toContain("bg-surface-subtle");
    expect(state).toHaveTextContent("Pick a workspace to continue.");
  });

  it("marks the optional icon decorative and does not create empty slots", () => {
    render(
      <EmptyState
        icon={<span data-testid="icon-mark">!</span>}
        description="Nothing needs your attention."
      />,
    );

    const iconSlot = screen.getByText("!").parentElement;
    expect(iconSlot).toHaveAttribute("data-slot", "empty-state-icon");
    expect(iconSlot).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("icon-mark")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByText("Create issue")).not.toBeInTheDocument();
  });
});
