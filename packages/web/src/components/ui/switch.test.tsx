import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "./switch";

describe("Switch", () => {
  it("exposes role=switch with aria-checked reflecting the bound state", () => {
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={vi.fn()} aria-label="Toggle" />,
    );
    const toggle = screen.getByRole("switch", { name: "Toggle" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    rerender(
      <Switch checked={true} onCheckedChange={vi.fn()} aria-label="Toggle" />,
    );
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("calls onCheckedChange with the negated state on click", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Switch
        checked={false}
        onCheckedChange={onCheckedChange}
        aria-label="Toggle"
      />,
    );

    await user.click(screen.getByRole("switch", { name: "Toggle" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("does not fire when disabled", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Switch
        checked={false}
        onCheckedChange={onCheckedChange}
        disabled
        aria-label="Toggle"
      />,
    );

    await user.click(screen.getByRole("switch", { name: "Toggle" }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
