import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Combobox, type ComboboxOption } from "./combobox";

const FRUITS: ComboboxOption<string>[] = [
  { value: "apple", label: "Apple", content: "Apple" },
  { value: "banana", label: "Banana", content: "Banana" },
  { value: "cherry", label: "Cherry", content: "Cherry" },
];

function Controlled({
  onChange,
  ...rest
}: {
  onChange?: (v: string | null) => void;
  searchable?: boolean;
  active?: boolean;
}) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Combobox<string>
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      options={FRUITS}
      ariaLabel="Fruit"
      placeholder="Pick a fruit"
      noneOption={{ label: "Any fruit" }}
      {...rest}
    />
  );
}

describe("Combobox", () => {
  it("shows the placeholder and a chevron when nothing is selected", () => {
    render(<Controlled />);
    const trigger = screen.getByLabelText("Fruit");
    expect(trigger).toHaveTextContent("Pick a fruit");
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  it("opens on click and commits the clicked option, then closes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.click(screen.getByLabelText("Fruit"));
    await user.click(screen.getByRole("option", { name: "Banana" }));

    expect(onChange).toHaveBeenCalledWith("banana");
    // Panel closed → option no longer in the DOM.
    expect(screen.queryByRole("option", { name: "Cherry" })).toBeNull();
  });

  it("selecting the none row emits null", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.click(screen.getByLabelText("Fruit"));
    await user.click(screen.getByRole("option", { name: "Any fruit" }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("navigates with the keyboard and commits with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    const trigger = screen.getByLabelText("Fruit");
    trigger.focus();
    // Open (ArrowDown) → active lands on the first row ("Any fruit").
    // Two more downs → Apple → Banana.
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("banana");
  });

  it("keeps the clear row usable during loading but Enter does not auto-clear", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Combobox<string>
        value="apple"
        onChange={onChange}
        options={[]}
        loading
        ariaLabel="Fruit"
        placeholder="Pick a fruit"
        renderValue={(v) => <span>{v}</span>}
        noneOption={{ label: "Any fruit" }}
      />,
    );
    await user.click(screen.getByLabelText("Fruit"));
    // Async options are still loading…
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    // …but the local clear row stays clickable above the skeleton.
    expect(
      screen.getByRole("option", { name: "Any fruit" }),
    ).toBeInTheDocument();
    // A bare Enter must not auto-commit (value "apple" isn't in the loaded page,
    // so no row is active).
    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    // Explicitly clicking the clear row still clears.
    await user.click(screen.getByRole("option", { name: "Any fruit" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows the search progress hairline while loading, and not when idle (REEF-369)", async () => {
    const user = userEvent.setup();
    const base = {
      value: null,
      onChange: () => {},
      searchable: true,
      onQueryChange: () => {},
      ariaLabel: "Fruit",
      placeholder: "Pick a fruit",
      noneOption: { label: "Any fruit" },
    } as const;
    const { rerender } = render(
      <Combobox<string> {...base} options={[]} loading />,
    );
    await user.click(screen.getByLabelText("Fruit"));
    // Async search in flight → the shared hairline shows at the panel's edge.
    expect(screen.getByTestId("search-progress-bar")).toBeInTheDocument();

    // Idle (no `loading`, e.g. a client-filter consumer) → it renders nothing,
    // even with the panel open. This is REEF-369 AC4's "no flash on instant
    // filters" at the primitive boundary.
    rerender(<Combobox<string> {...base} options={FRUITS} />);
    expect(screen.queryByTestId("search-progress-bar")).toBeNull();
  });

  it("commits the active option on Space instead of closing the menu", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    const trigger = screen.getByLabelText("Fruit");
    trigger.focus();
    // Open (ArrowDown) → none row, two more downs → Apple → Banana, then Space.
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}[Space]");

    expect(onChange).toHaveBeenCalledWith("banana");
    // Committing closes the menu (not reopened by a stray native click).
    expect(screen.queryByRole("option", { name: "Cherry" })).toBeNull();
  });

  it("closes on Escape without committing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    const trigger = screen.getByLabelText("Fruit");
    await user.click(trigger);
    expect(screen.getByRole("option", { name: "Apple" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("option", { name: "Apple" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("filters options client-side when searchable", async () => {
    const user = userEvent.setup();
    render(<Controlled searchable />);

    await user.click(screen.getByLabelText("Fruit"));
    const search = screen.getByPlaceholderText("Search…");
    await user.type(search, "ban");

    expect(screen.getByRole("option", { name: "Banana" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Apple" })).toBeNull();
    // The clear row is hidden while searching, so Enter on a query commits the
    // first match instead of silently clearing the field.
    expect(screen.queryByRole("option", { name: "Any fruit" })).toBeNull();
  });

  it("commits the first match on Enter while searching, never the clear row", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled searchable onChange={onChange} />);

    await user.click(screen.getByLabelText("Fruit"));
    await user.type(screen.getByPlaceholderText("Search…"), "ban{Enter}");

    expect(onChange).toHaveBeenCalledWith("banana");
    expect(onChange).not.toHaveBeenCalledWith(null);
  });

  it("reaches the empty state on a no-match search despite a none option", async () => {
    const user = userEvent.setup();
    render(<Controlled searchable />);

    await user.click(screen.getByLabelText("Fruit"));
    await user.type(screen.getByPlaceholderText("Search…"), "zzz");

    expect(screen.getByText("No results.")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Any fruit" })).toBeNull();
  });

  it("marks the selected option with a check", async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.click(screen.getByLabelText("Fruit"));
    await user.click(screen.getByRole("option", { name: "Apple" }));
    // Reopen and confirm the selected row carries a trailing check icon.
    await user.click(screen.getByLabelText("Fruit"));
    const appleRow = screen.getByRole("option", { name: "Apple" });
    expect(appleRow.querySelector("svg")).not.toBeNull();
  });

  it("draws the selected check in an absolute gutter, never an in-flow ml-auto item (REEF-144)", async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.click(screen.getByLabelText("Fruit"));
    await user.click(screen.getByRole("option", { name: "Apple" }));
    await user.click(screen.getByLabelText("Fruit"));

    // The check is pinned in the right rail (out of the content flex flow) so it
    // never shares a line with right-aligned caller meta like `@login`.
    const checkClass =
      screen
        .getByRole("option", { name: "Apple" })
        .querySelector("svg")
        ?.getAttribute("class") ?? "";
    expect(checkClass).toContain("absolute");
    expect(checkClass).toContain("right-2");
    expect(checkClass).not.toContain("ml-auto");
  });

  it("reserves the selection gutter on every row so truncation can't jump (REEF-144)", async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.click(screen.getByLabelText("Fruit"));
    await user.click(screen.getByRole("option", { name: "Apple" }));
    await user.click(screen.getByLabelText("Fruit"));

    // The right gutter (`pr-7`) is reserved on the base option chrome regardless
    // of selection, so a row gaining/losing its check never reflows the content
    // lane (AC4).
    const selectedRow = screen.getByRole("option", { name: "Apple" });
    const unselectedRow = screen.getByRole("option", { name: "Banana" });
    expect(selectedRow.className).toContain("pr-7");
    expect(unselectedRow.className).toContain("pr-7");
  });

  it("does not clear a value missing from the options on a bare Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Combobox<string>
        value="kiwi"
        onChange={onChange}
        options={FRUITS}
        ariaLabel="Fruit"
        placeholder="Pick"
        renderValue={(v) => <span>{v}</span>}
        noneOption={{ label: "Any fruit" }}
      />,
    );
    const trigger = screen.getByLabelText("Fruit");
    await user.click(trigger);
    // "kiwi" isn't in the loaded page, so no row is active — Enter must no-op
    // rather than committing the leading clear row.
    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    // Arrowing into the list still reaches real options.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("apple");
  });

  it("does not clear a missing value when opened through controlled state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Combobox<string>
        value="kiwi"
        onChange={onChange}
        options={FRUITS}
        open
        ariaLabel="Fruit"
        placeholder="Pick"
        renderValue={(v) => <span>{v}</span>}
        noneOption={{ label: "Any fruit" }}
      />,
    );

    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the caller's id so an external <label htmlFor> associates", () => {
    render(
      <div>
        <label htmlFor="fruit-field">Favorite fruit</label>
        <Combobox<string>
          id="fruit-field"
          value={null}
          onChange={() => {}}
          options={FRUITS}
          placeholder="Pick"
        />
      </div>,
    );
    // getByLabelText resolves the <label htmlFor> → the trigger owns the id.
    expect(screen.getByLabelText("Favorite fruit")).toHaveAttribute(
      "id",
      "fruit-field",
    );
  });

  it("paints the brand ring only when active", () => {
    // `bg-brand/10` is unique to the active token — the base trigger already
    // carries focus-visible:border-brand, so match on the fill instead.
    const { rerender } = render(<Controlled active={false} />);
    expect(screen.getByLabelText("Fruit").className).not.toContain(
      "bg-brand/10",
    );
    rerender(<Controlled active />);
    expect(screen.getByLabelText("Fruit").className).toContain("bg-brand/10");
  });

  it("scrolls only its own list, never an ancestor, when opening and navigating (REEF-145)", async () => {
    const user = userEvent.setup();
    // The panel is anchored inside the page flow (not portaled), so
    // `Element.scrollIntoView` would scroll every scrollable ancestor — the
    // issue detail sheet — and visibly shift the edit content. The open /
    // active-row effect must keep the active row visible by scrolling the list
    // alone, so this API must never fire.
    const spy = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<Controlled />);

    const trigger = screen.getByLabelText("Fruit");
    trigger.focus();
    // Open, then walk the keyboard active row down past several entries.
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("anchors the panel below the trigger and to the start by default (REEF-145)", async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.click(screen.getByLabelText("Fruit"));
    const panel = screen.getByRole("listbox").parentElement;
    // The vertical anchor is no longer baked into the shared panel token; it is
    // applied from collision-aware placement state, which defaults to opening
    // downward (top-full) and start-aligned (left-0) and only flips when a real
    // measurement shows the preferred corner would clip. jsdom can't measure, so
    // the unflipped default is what renders here.
    expect(panel?.className).toContain("top-full");
    expect(panel?.className).toContain("left-0");
    expect(panel?.className).not.toContain("bottom-full");
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
        if (this.dataset.testid === "scroll-boundary") {
          return new DOMRect(200, 100, 800, 420);
        }
        if (this.className.includes("fruit-panel")) {
          return new DOMRect(600, 492, 240, 256);
        }
        return new DOMRect(0, 0, 0, 0);
      });
    const user = userEvent.setup();

    render(
      <div data-testid="scroll-boundary" style={{ overflowY: "auto" }}>
        <Combobox<string>
          value={null}
          onChange={() => {}}
          options={FRUITS}
          ariaLabel="Fruit"
          placeholder="Pick a fruit"
          triggerTestId="fruit-trigger"
          contentClassName="fruit-panel"
        />
      </div>,
    );

    await user.click(screen.getByTestId("fruit-trigger"));

    await waitFor(() => {
      const panel = screen.getByRole("listbox").parentElement;
      expect(panel?.className).toContain("bottom-full");
    });

    rectSpy.mockRestore();
    heightSpy.mockRestore();
    widthSpy.mockRestore();
  });
});
