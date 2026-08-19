import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  usePopoverContext,
} from "./popover";

afterEach(cleanup);

function SelectAction() {
  const { close } = usePopoverContext();
  return (
    <button type="button" onClick={() => close("select")}>
      Choose
    </button>
  );
}

describe("Popover", () => {
  it("requires an explicit semantic role and accessible name", () => {
    expect(() =>
      render(
        <Popover defaultOpen>
          <PopoverTrigger>Open</PopoverTrigger>
          {/* @ts-expect-error The runtime contract also requires these props. */}
          <PopoverContent>Panel</PopoverContent>
        </Popover>,
      ),
    ).toThrow("PopoverContent requires an explicit role and accessible name");
  });

  it("uses motion-safe animation classes and a caller-owned role", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger aria-haspopup="dialog">Open</PopoverTrigger>
        <PopoverContent role="dialog" aria-label="Options">
          Panel
        </PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));

    const panel = screen.getByRole("dialog", { name: "Options" });
    expect(panel.className).toContain("motion-safe:animate-in");
    expect(panel.className).toContain("motion-safe:fade-in-0");
    expect(panel.className).not.toContain(" animate-in ");
    expect(panel).not.toHaveAttribute("role", "menu");
  });

  it("opens from the keyboard and focuses the first search input", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent role="dialog" aria-label="Search">
          <input aria-label="Search terms" />
          <button type="button">Submit</button>
        </PopoverContent>
      </Popover>,
    );

    await user.tab();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search terms" })).toHaveFocus();
  });

  it("returns focus to the trigger after Escape", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Popover onOpenChange={onOpenChange}>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent role="dialog" aria-label="Panel">
          <input aria-label="Query" />
        </PopoverContent>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Open" });

    await user.click(trigger);
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Panel" }),
      ).not.toBeInTheDocument(),
    );
    expect(onOpenChange).toHaveBeenLastCalledWith(false, "escape");
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(trigger).toHaveFocus();
  });

  it("returns focus to the trigger after selection-complete close", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent role="dialog" aria-label="Choose an option">
          <SelectAction />
        </PopoverContent>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Open" });

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Choose" }));

    expect(screen.queryByRole("dialog", { name: "Choose an option" })).not.toBeInTheDocument();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(trigger).toHaveFocus();
  });

  it("closes on a trigger re-click without reopening", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent role="dialog" aria-label="Panel">
          <input aria-label="Query" />
        </PopoverContent>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Open" });

    await user.click(trigger);
    await user.click(trigger);

    expect(screen.queryByRole("dialog", { name: "Panel" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("preserves the outside click target's focus", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Popover>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent role="dialog" aria-label="Panel">
            <input aria-label="Query" />
          </PopoverContent>
        </Popover>
        <button type="button">Outside</button>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    const outside = screen.getByRole("button", { name: "Outside" });

    await user.click(outside);

    expect(screen.queryByRole("dialog", { name: "Panel" })).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
  });

  it("preserves an outside focus target for a controlled close", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger>Open</PopoverTrigger>
            <PopoverContent role="dialog" aria-label="Panel">
              <input aria-label="Query" />
            </PopoverContent>
          </Popover>
          <button type="button" onFocus={() => setOpen(false)}>
            Outside
          </button>
        </>
      );
    }

    render(<Harness />);
    const outside = screen.getByRole("button", { name: "Outside" });

    outside.focus();

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Panel" }),
      ).not.toBeInTheDocument(),
    );
    expect(outside).toHaveFocus();
  });

  it("returns focus to the external origin when it mounts already open", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Origin
          </button>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger>Panel trigger</PopoverTrigger>
            <PopoverContent role="dialog" aria-label="Panel">
              <input aria-label="Query" />
            </PopoverContent>
          </Popover>
        </>
      );
    }

    render(<Harness />);
    const origin = screen.getByRole("button", { name: "Origin" });

    await user.click(origin);
    await user.keyboard("{Escape}");

    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(origin).toHaveFocus();
  });

  it("lets a nested popover consume Escape before its parent", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Parent</PopoverTrigger>
        <PopoverContent role="dialog" aria-label="Parent panel">
          <Popover>
            <PopoverTrigger>Child</PopoverTrigger>
            <PopoverContent role="dialog" aria-label="Child panel">
              <button type="button">Child action</button>
            </PopoverContent>
          </Popover>
        </PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Parent" }));
    await user.click(screen.getByRole("button", { name: "Child" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Child panel" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Parent panel" })).toBeInTheDocument();
  });
});
