import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComboboxOption } from "./combobox";
import { MultiSelectCombobox } from "./multi-select-combobox";

afterEach(cleanup);

type Fruit = "apple" | "banana" | "cherry";

const OPTIONS: ComboboxOption<Fruit>[] = [
  { value: "apple", label: "Apple", content: <span>Apple</span>, testId: "opt-apple" },
  { value: "banana", label: "Banana", content: <span>Banana</span>, testId: "opt-banana" },
  { value: "cherry", label: "Cherry", content: <span>Cherry</span>, testId: "opt-cherry" },
];

/** Controlled harness mirroring how FilterBar folds toggles into a stored array. */
function Harness({ active }: { active?: boolean } = {}) {
  const [values, setValues] = useState<Fruit[]>([]);
  return (
    <MultiSelectCombobox
      label="Fruit"
      values={values}
      onToggle={(value, checked) =>
        setValues((prev) =>
          checked ? [...prev, value] : prev.filter((v) => v !== value),
        )
      }
      options={OPTIONS}
      active={active}
      ariaLabel="Fruit"
      triggerTestId="fruit-trigger"
      contentTestId="fruit-content"
    />
  );
}

describe("MultiSelectCombobox", () => {
  it("toggles multiple values while keeping the panel open (multi-select) — AC3", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("fruit-trigger"));
    expect(screen.queryByTestId("fruit-content")).not.toBeNull();

    await user.click(screen.getByTestId("opt-apple"));
    // The panel must stay open so a second member can be added in one visit.
    expect(screen.queryByTestId("fruit-content")).not.toBeNull();
    expect(screen.getByTestId("opt-apple").getAttribute("aria-checked")).toBe(
      "true",
    );

    await user.click(screen.getByTestId("opt-banana"));
    expect(screen.getByTestId("opt-banana").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByTestId("opt-apple").getAttribute("aria-checked")).toBe(
      "true",
    );

    // Re-clicking a selected row unchecks it.
    await user.click(screen.getByTestId("opt-apple"));
    expect(screen.getByTestId("opt-apple").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("re-clicking an open trigger closes the panel (REEF-073) — AC3", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByTestId("fruit-trigger");

    await user.click(trigger);
    expect(screen.queryByTestId("fruit-content")).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    await user.click(trigger);
    expect(screen.queryByTestId("fruit-content")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on an outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button" data-testid="outside">
          outside
        </button>
        <Harness />
      </div>,
    );

    await user.click(screen.getByTestId("fruit-trigger"));
    expect(screen.queryByTestId("fruit-content")).not.toBeNull();

    await user.click(screen.getByTestId("outside"));
    expect(screen.queryByTestId("fruit-content")).toBeNull();
  });

  it("toggles the active row from the keyboard and stays open, closing on Escape — AC3", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByTestId("fruit-trigger");

    trigger.focus();
    await user.keyboard("{ArrowDown}"); // open, active = Apple
    expect(screen.queryByTestId("fruit-content")).not.toBeNull();
    await user.keyboard("{ArrowDown}"); // active = Banana
    await user.keyboard("{Enter}"); // toggle Banana

    expect(screen.getByTestId("opt-banana").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.queryByTestId("fruit-content")).not.toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("fruit-content")).toBeNull();
  });

  it("marks a selected row with a trailing brand Check, never a leading text ✓ — AC2", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("fruit-trigger"));
    await user.click(screen.getByTestId("opt-apple"));

    const option = screen.getByTestId("opt-apple");
    const check = option.querySelector("svg");
    expect(check).not.toBeNull();
    const checkClass = check?.getAttribute("class") ?? "";
    // The check lives in the absolute right gutter (REEF-144), not the content
    // flex flow — so it never competes with right-aligned caller meta. It is no
    // longer an `ml-auto` flex item.
    expect(checkClass).toContain("absolute");
    expect(checkClass).toContain("right-2");
    expect(checkClass).not.toContain("ml-auto");
    expect(checkClass).toContain("text-brand");
    // The old facet drew a leading literal "✓"; it must be gone.
    expect(option.textContent ?? "").not.toContain("✓");
  });

  it("draws option rows on the shared combobox chrome tokens — AC1/AC5", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("fruit-trigger"));
    const cls = screen.getByTestId("opt-apple").className;
    // CBX_OPTION_BASE — the px-2 py-1.5 / text-[13px] the single-select uses,
    // NOT the old facet checkbox item's px-2 py-1.
    expect(cls).toContain("py-1.5");
    expect(cls).toContain("text-[13px]");
  });

  it("rotates the trigger chevron on open and rings the trigger when active — AC4", async () => {
    const user = userEvent.setup();
    render(<Harness active />);
    const trigger = screen.getByTestId("fruit-trigger");

    // Active facet draws the SAME brand ring token as the field comboboxes.
    expect(trigger.className).toContain("ring-brand/30");

    const chevron = trigger.querySelector("svg");
    expect(chevron?.getAttribute("class") ?? "").toContain(
      "data-[open=true]:rotate-180",
    );
    expect(trigger.querySelector("svg")?.getAttribute("data-open")).toBe(
      "false",
    );

    await user.click(trigger);
    expect(trigger.querySelector("svg")?.getAttribute("data-open")).toBe(
      "true",
    );
  });

  it("renders each option's data-testid from the shared option field", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("fruit-trigger"));
    expect(screen.getByTestId("opt-apple")).toBeTruthy();
    expect(screen.getByTestId("opt-cherry")).toBeTruthy();
  });

  it("keeps the selection summary in the trigger's accessible name (no static aria-label) — AC3", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("fruit-trigger"));
    await user.click(screen.getByTestId("opt-apple"));

    const trigger = screen.getByTestId("fruit-trigger");
    // A static aria-label would pin the name to "Fruit" and hide the selection
    // from screen readers; the accessible name must come from the visible text.
    expect(trigger.getAttribute("aria-label")).toBeNull();
    expect(trigger).toHaveAccessibleName(/Fruit \(apple\)/);
  });

  it("scrolls only its own list, never an ancestor, when opening and navigating (REEF-145)", async () => {
    const user = userEvent.setup();
    // Like the single-select sibling, this panel is anchored in the page flow
    // (not portaled), so `Element.scrollIntoView` would drag a surrounding
    // scroll container. The active-row effect must scroll the list alone.
    const spy = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<Harness />);

    const trigger = screen.getByTestId("fruit-trigger");
    trigger.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("opens upward when a containing scroll panel has less room than the viewport", async () => {
    const widthSpy = vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    const heightSpy = vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.testid === "fruit-trigger") {
          return new DOMRect(600, 460, 320, 32);
        }
        if (this.dataset.testid === "fruit-content") {
          return new DOMRect(600, 492, 240, 256);
        }
        if (this.dataset.testid === "scroll-boundary") {
          return new DOMRect(200, 100, 800, 420);
        }
        return new DOMRect(0, 0, 0, 0);
      });
    const user = userEvent.setup();

    render(
      <div data-testid="scroll-boundary" style={{ overflowY: "auto" }}>
        <MultiSelectCombobox
          label="Fruit"
          values={[]}
          onToggle={() => {}}
          options={OPTIONS}
          triggerTestId="fruit-trigger"
          contentTestId="fruit-content"
        />
      </div>,
    );

    await user.click(screen.getByTestId("fruit-trigger"));

    await waitFor(() => {
      expect(screen.getByTestId("fruit-content").className).toContain(
        "bottom-full",
      );
    });

    rectSpy.mockRestore();
    heightSpy.mockRestore();
    widthSpy.mockRestore();
  });
});
