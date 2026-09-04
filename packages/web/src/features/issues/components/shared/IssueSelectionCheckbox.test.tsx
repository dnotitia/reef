import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IssueSelectionCheckbox } from "./IssueSelectionCheckbox";

describe("IssueSelectionCheckbox", () => {
  it("uses one labeled hit target and does not bubble selection to the row", async () => {
    const parentClick = vi.fn();
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { container, rerender } = render(
      <div onClick={parentClick} onKeyDown={() => {}}>
        <IssueSelectionCheckbox
          checked={false}
          label="Select REEF-101"
          onChange={onChange}
          testId="selection-checkbox"
        />
      </div>,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Select REEF-101",
    });
    const hitTarget = checkbox.closest("label");
    expect(hitTarget).toHaveClass("size-8", "touch-manipulation");
    expect(hitTarget).toHaveClass("reef-selection-checkbox");
    expect(hitTarget).not.toHaveClass("focus-within:ring-2");
    expect(checkbox).toHaveClass(
      "absolute",
      "inset-0",
      "size-full",
      "opacity-0",
    );
    expect(
      container.querySelector('[data-slot="selection-checkbox-indicator"]'),
    ).toHaveClass("size-3.5", "bg-surface-elevated", "border-input");

    await user.click(hitTarget as HTMLLabelElement);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();

    rerender(
      <div onClick={parentClick} onKeyDown={() => {}}>
        <IssueSelectionCheckbox
          checked
          label="Select REEF-101"
          onChange={onChange}
          testId="selection-checkbox"
        />
      </div>,
    );
    expect(
      container.querySelector('[data-slot="selection-checkbox-indicator"]'),
    ).toHaveClass("border-brand-focus", "bg-brand-fill", "text-brand-on-fill");
  });

  it("exposes the mixed state on the native checkbox", () => {
    render(
      <IssueSelectionCheckbox
        checked={false}
        indeterminate
        label="Select all loaded issues"
        onChange={() => {}}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: "Select all loaded issues" }),
    ).toHaveAttribute("aria-checked", "mixed");
  });

  it("toggles from both Enter and Space without bubbling to the row", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <IssueSelectionCheckbox
        checked={false}
        label="Select REEF-101"
        onChange={onChange}
      />,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Select REEF-101",
    });
    checkbox.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
