import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

afterEach(cleanup);

/**
 * Minimal harness for the menu's open/close behavior: a trigger, a single item,
 * and a sibling element to click "outside". (Multi-select / checkbox behavior
 * moved to the shared MultiSelectCombobox primitive — see
 * multi-select-combobox.test.tsx — so this only exercises DropdownMenu itself.)
 */
function Harness() {
  return (
    <div>
      <button type="button" data-testid="outside">
        outside
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger data-testid="trigger">Status</DropdownMenuTrigger>
        <DropdownMenuContent data-testid="content">
          <DropdownMenuItem data-testid="option">Open</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

describe("DropdownMenu", () => {
  it("re-clicking an open trigger closes the menu and does not re-open (REEF-073)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByTestId("trigger");

    await user.click(trigger);
    expect(screen.queryByTestId("content")).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    // The bug: mousedown closed the menu, then the trigger's click re-opened it.
    await user.click(trigger);
    expect(screen.queryByTestId("content")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("highlights items on focus-visible, not bare focus (REEF-172)", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("trigger"));
    // Keyboard focus shows the highlight; a programmatic/pointer :focus should
    // not, so menu items match the focus-visible convention used elsewhere.
    const item = screen.getByTestId("option");
    expect(item.className).toContain("focus-visible:bg-surface-hover");
    expect(item.className).not.toContain("focus:bg-surface-hover");
  });

  it("forwards a root className so callers can make the menu full-width (REEF-168)", () => {
    render(
      <DropdownMenu className="w-full">
        <DropdownMenuTrigger data-testid="trigger">Status</DropdownMenuTrigger>
      </DropdownMenu>,
    );

    // The className lands on the root wrapper (the trigger's parent), letting a
    // caller stretch the otherwise inline-block menu to fill its row.
    expect(screen.getByTestId("trigger").parentElement).toHaveClass("w-full");
  });

  it("closes the menu on an outside click", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("trigger"));
    expect(screen.queryByTestId("content")).not.toBeNull();

    await user.click(screen.getByTestId("outside"));
    expect(screen.queryByTestId("content")).toBeNull();
  });

  it("toggles open and closed from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByTestId("trigger");

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByTestId("content")).not.toBeNull();

    await user.keyboard(" ");
    expect(screen.queryByTestId("content")).toBeNull();
  });
});

/** Harness for the open-direction / Escape behavior (REEF-068). */
function Menu({ side }: { side?: "top" | "bottom" }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent side={side} data-testid="content">
        <DropdownMenuItem>Item</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("DropdownMenuContent", () => {
  it("opens downward by default and upward with side='top'", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Menu />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("content").className).toContain("top-full");

    rerender(<Menu side="top" />);
    expect(screen.getByTestId("content").className).toContain("bottom-full");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Menu />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("uses motion-safe animation classes so reduced-motion can suppress them (REEF-171)", async () => {
    const user = userEvent.setup();
    render(<Menu />);

    await user.click(screen.getByRole("button", { name: "Open" }));

    // Matches the Popover primitive: the enter animation is gated behind
    // motion-safe so prefers-reduced-motion suppresses it. The raw, ungated
    // `animate-in` previously ran regardless of the user's motion setting.
    const content = screen.getByRole("menu");
    expect(content.className).toContain("motion-safe:animate-in");
    expect(content.className).toContain("motion-safe:fade-in-0");
    expect(content.className).not.toContain(" animate-in ");
  });
});
