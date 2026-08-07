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
      />,
    );

    const state = screen.getByTestId("section-empty");
    expect(state).toHaveAttribute("data-slot", "empty-state");
    expect(state.className).toContain("mx-auto");
    expect(state.className).toContain("h-48");
    expect(state.className).toContain("min-h-48");
    expect(state.className).toContain("w-full");
    expect(state.className).toContain("max-w-4xl");
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
    expect(state.querySelectorAll("h2")).toHaveLength(1);
    expect(state.querySelectorAll("p")).toHaveLength(1);
    expect(state.querySelector('[data-slot="empty-state-icon"]')).toBeNull();
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

  it("keeps structure content unboxed without section-only slots", () => {
    render(
      <EmptyState
        variant="structure"
        description="Nothing needs your attention."
      />,
    );

    const state = screen.getByText("Nothing needs your attention.").parentElement
      ?.parentElement;
    expect(state).toBeTruthy();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(state?.querySelector('[data-slot="empty-state-icon"]')).toBeNull();
  });
});
