import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./context-menu";

afterEach(cleanup);

function Harness() {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button type="button" data-testid="trigger">
          Open menu
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent data-testid="content">
        <ContextMenuItem data-testid="first-item">First</ContextMenuItem>
        <ContextMenuItem>Second</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

describe("ContextMenu", () => {
  it("opens from a pointer context-menu event and focuses the first item", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByTestId("trigger");

    fireEvent.contextMenu(trigger, { clientX: 40, clientY: 60 });

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByTestId("first-item")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByText("Second")).toHaveFocus();
  });

  it("opens from Shift+F10 and Menu key without changing the trigger action", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    fireEvent.keyDown(trigger, { key: "ContextMenu" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("keeps the existing reduced-motion and focus styling contract", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    fireEvent.contextMenu(screen.getByTestId("trigger"));

    const content = screen.getByTestId("content");
    expect(content.className).toContain("motion-safe:animate-in");
    expect(content.className).toContain("motion-reduce:animate-none");
    expect(screen.getByTestId("first-item").className).toContain(
      "focus-visible:bg-surface-hover",
    );
    await user.keyboard("{Escape}");
  });
});
