import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PersonChip } from "./PersonChip";

afterEach(() => {
  cleanup();
});

describe("PersonChip", () => {
  it("shows the display name when present, login otherwise", () => {
    const { rerender } = render(
      <PersonChip identityKey="alice" name="Alice Example" />,
    );
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    rerender(<PersonChip identityKey="alice" />);
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("renders a muted fallback label when no one is assigned", () => {
    render(<PersonChip identityKey={null} fallbackLabel="Unassigned" />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("appends secondary text such as the @login", () => {
    render(
      <PersonChip
        identityKey="alice"
        name="Alice Example"
        secondary="@alice"
      />,
    );
    expect(screen.getByText("@alice")).toBeInTheDocument();
  });

  it("makes the avatar decorative — the visible label is the accessible name", () => {
    const { container } = render(
      <PersonChip identityKey="alice" name="Alice Example" />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
