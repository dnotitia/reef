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
    const heading = screen.getByRole("heading", { name: "No issues yet" });
    const description = screen.getByText("Create an issue to begin.");
    expect(description).toBeInTheDocument();
    expect(state.querySelectorAll("h2")).toHaveLength(1);
    expect(state.querySelectorAll("p")).toHaveLength(1);
    expect(state.tagName).toBe("SECTION");
    expect(state).toHaveAccessibleName("No issues yet");
    expect(state).toHaveAccessibleDescription("Create an issue to begin.");
    expect(state).toHaveAttribute("aria-labelledby", heading.id);
    expect(state).toHaveAttribute("aria-describedby", description.id);
    expect(screen.getByRole("region", { name: "No issues yet" })).toBe(state);
    expect(state.querySelector('[data-slot="empty-state-icon"]')).toBeNull();
  });

  it("gives each section instance unique visible-content references", () => {
    render(
      <>
        <EmptyState
          data-testid="first-section-empty"
          title="First empty state"
          description="First explanation."
        />
        <EmptyState
          data-testid="second-section-empty"
          title="Second empty state"
          description="Second explanation."
        />
      </>,
    );

    const first = screen.getByTestId("first-section-empty");
    const second = screen.getByTestId("second-section-empty");
    const firstReferences = [
      first.getAttribute("aria-labelledby"),
      first.getAttribute("aria-describedby"),
    ];
    const secondReferences = [
      second.getAttribute("aria-labelledby"),
      second.getAttribute("aria-describedby"),
    ];

    expect(new Set([...firstReferences, ...secondReferences]).size).toBe(4);
    expect(first).toHaveAccessibleName("First empty state");
    expect(first).toHaveAccessibleDescription("First explanation.");
    expect(second).toHaveAccessibleName("Second empty state");
    expect(second).toHaveAccessibleDescription("Second explanation.");
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
    expect(state).not.toHaveAttribute("role", "region");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
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
