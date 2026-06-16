import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

afterEach(cleanup);

describe("Popover", () => {
  it("uses motion-safe animation classes so reduced-motion can suppress them", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Panel</PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));

    const panel = screen.getByRole("dialog");
    expect(panel.className).toContain("motion-safe:animate-in");
    expect(panel.className).toContain("motion-safe:fade-in-0");
    expect(panel.className).not.toContain(" animate-in ");
  });

  it("closes on Escape, matching the dropdown-menu primitive (REEF-171)", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Panel</PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
