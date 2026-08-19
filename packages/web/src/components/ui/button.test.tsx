import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button focus indicator", () => {
  it("uses a solid foreground outline with at least two pixels of visible chrome", () => {
    render(<Button>Clear filters</Button>);

    expect(screen.getByRole("button", { name: "Clear filters" })).toHaveClass(
      "focus-visible:outline-2",
      "focus-visible:outline-foreground",
      "focus-visible:outline-offset-1",
    );
  });

  it("keeps independent controls at a coarse-pointer hit target", () => {
    render(
      <>
        <Button>Save</Button>
        <Button size="icon" aria-label="More" />
        <Button size="icon-sm" aria-label="Compact" />
      </>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass(
      "[@media(pointer:coarse)]:min-h-11",
      "[@media(pointer:coarse)]:min-w-11",
    );
    expect(screen.getByRole("button", { name: "More" })).toHaveClass(
      "[@media(pointer:coarse)]:min-h-11",
      "[@media(pointer:coarse)]:min-w-11",
    );
    expect(screen.getByRole("button", { name: "Compact" })).not.toHaveClass(
      "[@media(pointer:coarse)]:min-w-11",
    );
  });

  it("blocks duplicate activation while busy and keeps its accessible name", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button busy aria-label="Save issue" onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save issue" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Save");

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
