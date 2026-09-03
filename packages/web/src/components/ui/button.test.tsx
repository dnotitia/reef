import { fireEvent, render, screen } from "@testing-library/react";
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

  it("keeps independent controls coarse and makes compact ownership explicit", () => {
    render(
      <>
        <Button>Save</Button>
        <Button size="sm">New issue</Button>
        <Button size="icon" aria-label="More" />
        <Button size="icon-sm" aria-label="Independent icon action" />
        <Button
          size="icon-sm"
          hitTarget="compact"
          aria-label="Dense row action"
        />
      </>,
    );

    for (const name of [
      "Save",
      "New issue",
      "More",
      "Independent icon action",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveClass(
        "[@media(pointer:coarse)]:min-h-11",
        "[@media(pointer:coarse)]:min-w-11",
      );
    }
    expect(
      screen.getByRole("button", { name: "New issue" }),
    ).toHaveClass("h-7");
    expect(
      screen.getByRole("button", { name: "Independent icon action" }),
    ).toHaveClass("h-7", "w-7");
    expect(
      screen.getByRole("button", { name: "Dense row action" }),
    ).not.toHaveClass("[@media(pointer:coarse)]:min-w-11");
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

  it("keeps a disabled asChild control from activating or bubbling", () => {
    const parentClick = vi.fn();
    const childClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <Button asChild disabled onClick={childClick}>
          <a href="/issues">Open issue</a>
        </Button>
      </div>,
    );

    const link = screen.getByRole("link", { name: "Open issue" });
    fireEvent.click(link);
    fireEvent.keyDown(link, { key: "Enter" });

    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(childClick).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });
});
