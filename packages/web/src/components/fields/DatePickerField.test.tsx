import { localTodayIso } from "@/features/issues/lib/dateHelpers";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatePickerField } from "./DatePickerField";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DatePickerField", () => {
  it("shows the placeholder and tokenized trigger when empty", () => {
    render(<DatePickerField value="" onChange={vi.fn()} label="Start date" />);
    const trigger = screen.getByTestId("date-picker-trigger");
    expect(trigger).toHaveTextContent("Set date");
    // Theming comes from design tokens, not hard-coded colors → dark mode works.
    expect(trigger.className).toContain("bg-elevated");
    expect(screen.queryByTestId("date-picker-clear")).not.toBeInTheDocument();
  });

  it("localizes the empty placeholder in ko (REEF-309)", () => {
    render(
      <IntlTestProvider locale="ko">
        <DatePickerField value="" onChange={vi.fn()} />
      </IntlTestProvider>,
    );
    const trigger = screen.getByTestId("date-picker-trigger");
    // Catalog-owned placeholder instead of the assembled English "Set date".
    expect(trigger).toHaveTextContent("날짜 지정");
    expect(trigger).not.toHaveTextContent("Set date");
  });

  it("localizes the clear-control aria-label in ko (REEF-309)", () => {
    render(
      <IntlTestProvider locale="ko">
        <DatePickerField value="2026-06-25" onChange={vi.fn()} label="마감일" />
      </IntlTestProvider>,
    );
    // aria-label keys off the catalog's "{field} 지우기" copy.
    expect(screen.getByTestId("date-picker-clear")).toHaveAttribute(
      "aria-label",
      "마감일 지우기",
    );
  });

  it("renders the value and an accessible label when set", () => {
    render(
      <DatePickerField
        value="2026-06-01"
        onChange={vi.fn()}
        label="Start date"
      />,
    );
    expect(
      screen.getByLabelText("Start date: Jun 1, 2026"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("date-picker-trigger")).toHaveTextContent(
      "Jun 1, 2026",
    );
  });

  it("normalizes a fuller ISO timestamp to the date portion", () => {
    render(
      <DatePickerField
        value="2026-06-01T08:00:00Z"
        onChange={vi.fn()}
        label="Start date"
      />,
    );
    expect(
      screen.getByLabelText("Start date: Jun 1, 2026"),
    ).toBeInTheDocument();
  });

  it("opens the calendar and selects a day", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePickerField
        value="2026-06-01"
        onChange={onChange}
        label="Start date"
      />,
    );
    await user.click(screen.getByTestId("date-picker-trigger"));
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    await user.click(screen.getByTestId("calendar-day-2026-06-20"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-06-20");
  });

  it("opens upward when the measured calendar would overflow the viewport bottom", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(360);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "date-picker-trigger") {
          return new DOMRect(100, 300, 320, 32);
        }
        if (this.dataset.testid === "date-picker-panel") {
          return new DOMRect(100, 332, 256, 320);
        }
        return new DOMRect(0, 0, 0, 0);
      },
    );

    const user = userEvent.setup();
    render(<DatePickerField value="" onChange={vi.fn()} label="Start date" />);

    await user.click(screen.getByTestId("date-picker-trigger"));

    await waitFor(() => {
      expect(screen.getByTestId("date-picker-panel").className).toContain(
        "bottom-full",
      );
    });
  });

  it("opens upward when a containing scroll panel has less room than the viewport", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "date-picker-trigger") {
          return new DOMRect(600, 460, 320, 32);
        }
        if (this.dataset.testid === "date-picker-panel") {
          return new DOMRect(707, 492, 256, 360);
        }
        if (this.dataset.testid === "scroll-boundary") {
          return new DOMRect(200, 100, 800, 420);
        }
        return new DOMRect(0, 0, 0, 0);
      },
    );

    const user = userEvent.setup();
    render(
      <div data-testid="scroll-boundary" style={{ overflowY: "auto" }}>
        <DatePickerField
          value=""
          onChange={vi.fn()}
          label="End date"
          align="end"
        />
      </div>,
    );

    await user.click(screen.getByTestId("date-picker-trigger"));

    await waitFor(() => {
      expect(screen.getByTestId("date-picker-panel").className).toContain(
        "bottom-full",
      );
    });
  });

  it("flips horizontal alignment when a start-anchored panel would overflow right", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "date-picker-trigger") {
          return new DOMRect(850, 120, 120, 32);
        }
        if (this.dataset.testid === "date-picker-panel") {
          return new DOMRect(850, 152, 256, 320);
        }
        return new DOMRect(0, 0, 0, 0);
      },
    );

    const user = userEvent.setup();
    render(<DatePickerField value="" onChange={vi.fn()} label="Start date" />);

    await user.click(screen.getByTestId("date-picker-trigger"));

    await waitFor(() => {
      const panelClass = screen.getByTestId("date-picker-panel").className;
      expect(panelClass).toContain("right-0");
      expect(panelClass).not.toContain("left-0");
    });
  });

  it("closes when the trigger is clicked a second time", async () => {
    const user = userEvent.setup();
    render(<DatePickerField value="" onChange={vi.fn()} label="Start date" />);
    const trigger = screen.getByTestId("date-picker-trigger");
    await user.click(trigger);
    expect(screen.getByTestId("date-picker-input")).toBeInTheDocument();
    // Re-clicking the trigger should dismiss the picker, not close-then-re-open.
    await user.click(trigger);
    expect(screen.queryByTestId("date-picker-input")).not.toBeInTheDocument();
  });

  it("draws the typed-date input's ring on keyboard focus only (REEF-226)", async () => {
    const user = userEvent.setup();
    render(<DatePickerField value="" onChange={vi.fn()} label="Start date" />);
    await user.click(screen.getByTestId("date-picker-trigger"));
    const input = screen.getByTestId("date-picker-input");
    // Shared brand ring, keyed off focus-visible so a mouse click does not flashes it.
    expect(input.className).toContain("focus-visible:ring-brand/30");
    expect(input.className).not.toContain("focus:ring");
  });

  it("sets the browser-local today via the Today action", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePickerField value="" onChange={onChange} label="Start date" />);
    await user.click(screen.getByTestId("date-picker-trigger"));
    await user.click(screen.getByTestId("date-picker-today"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(localTodayIso());
  });

  it("clears the value from the trigger affordance", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePickerField
        value="2026-06-01"
        onChange={onChange}
        label="Start date"
      />,
    );
    await user.click(screen.getByTestId("date-picker-clear"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("clears without first saving a typed draft from the open picker", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePickerField
        value="2026-06-01"
        onChange={onChange}
        label="Start date"
      />,
    );
    await user.click(screen.getByTestId("date-picker-trigger"));
    await user.clear(screen.getByTestId("date-picker-input"));
    await user.type(screen.getByTestId("date-picker-input"), "2026-08-15");
    // The trigger X should clear outright, not auto-save the typed draft first.
    await user.click(screen.getByTestId("date-picker-clear"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("accepts a typed YYYY-MM-DD value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePickerField value="" onChange={onChange} label="Start date" />);
    await user.click(screen.getByTestId("date-picker-trigger"));
    const input = screen.getByTestId("date-picker-input");
    await user.type(input, "2026-08-15{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-08-15");
  });

  it("does not clear a saved date when tabbed through while closed", () => {
    const onChange = vi.fn();
    render(
      <div>
        <DatePickerField
          value="2026-06-01"
          onChange={onChange}
          label="Start date"
        />
        <button type="button" data-testid="after-field">
          after
        </button>
      </div>,
    );
    // does not open the picker; focus moves across the closed trigger to the next
    // field. The stale empty draft should not be committed as a clear.
    fireEvent.focusOut(screen.getByTestId("date-picker-trigger"), {
      relatedTarget: screen.getByTestId("after-field"),
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears an existing date when the text input is emptied", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePickerField
        value="2026-06-01"
        onChange={onChange}
        label="Start date"
      />,
    );
    await user.click(screen.getByTestId("date-picker-trigger"));
    await user.clear(screen.getByTestId("date-picker-input"));
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("ignores an invalid typed value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePickerField value="" onChange={onChange} label="Start date" />);
    await user.click(screen.getByTestId("date-picker-trigger"));
    const input = screen.getByTestId("date-picker-input");
    await user.type(input, "2026-02-30{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits a typed value when the panel closes on click-away", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePickerField value="" onChange={onChange} label="Start date" />);
    await user.click(screen.getByTestId("date-picker-trigger"));
    await user.type(screen.getByTestId("date-picker-input"), "2026-08-15");
    // Close by clicking outside instead of pressing Enter.
    await user.click(document.body);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-08-15");
  });

  it("discards a typed value when cancelled with Escape", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePickerField value="" onChange={onChange} label="Start date" />);
    await user.click(screen.getByTestId("date-picker-trigger"));
    await user.type(screen.getByTestId("date-picker-input"), "2026-08-15");
    await user.keyboard("{Escape}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("handles Escape itself without bubbling to an enclosing surface", async () => {
    const user = userEvent.setup();
    const parentKeyDown = vi.fn();
    render(
      <div onKeyDown={parentKeyDown}>
        <DatePickerField value="" onChange={vi.fn()} label="Start date" />
      </div>,
    );
    // Open from the trigger; focus stays on the trigger (not in the panel).
    await user.click(screen.getByTestId("date-picker-trigger"));
    expect(screen.getByTestId("date-picker-input")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    // The picker closed and Escape did not reach the enclosing dialog/sheet.
    expect(screen.queryByTestId("date-picker-input")).not.toBeInTheDocument();
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it("commits a typed value when focus leaves the whole picker", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <>
        <DatePickerField value="" onChange={onChange} label="Start date" />
        <button type="button" data-testid="outside-field">
          next
        </button>
      </>,
    );
    await user.click(screen.getByTestId("date-picker-trigger"));
    const input = screen.getByTestId("date-picker-input");
    await user.type(input, "2026-08-15");
    // Focus moves to a control outside the picker (e.g. tabbing on to the next
    // form field). focusOut bubbles to the picker's root boundary, which should
    // commit the typed value rather than silently drop it.
    fireEvent.focusOut(input, {
      relatedTarget: screen.getByTestId("outside-field"),
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-08-15");
    // The calendar should not linger open once focus has left the picker.
    expect(screen.queryByTestId("date-picker-input")).not.toBeInTheDocument();
  });

  it("keeps a typed value while tabbing through in-picker controls", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePickerField value="" onChange={onChange} label="Start date" />);
    await user.click(screen.getByTestId("date-picker-trigger"));
    const input = screen.getByTestId("date-picker-input");
    await user.type(input, "2026-08-15");
    // Focus moving to a control inside the picker should not auto-save yet…
    fireEvent.focusOut(input, {
      relatedTarget: screen.getByLabelText("Next month"),
    });
    expect(onChange).not.toHaveBeenCalled();
    // …but leaving the picker entirely from that inner control commits it.
    fireEvent.focusOut(screen.getByLabelText("Next month"), {
      relatedTarget: document.body,
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-08-15");
    expect(screen.queryByTestId("date-picker-input")).not.toBeInTheDocument();
  });

  it("does not emit the typed draft before an in-picker calendar pick", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePickerField
        value="2026-06-01"
        onChange={onChange}
        label="Start date"
      />,
    );
    await user.click(screen.getByTestId("date-picker-trigger"));
    await user.clear(screen.getByTestId("date-picker-input"));
    await user.type(screen.getByTestId("date-picker-input"), "2026-08-15");
    // Clicking a day moves focus within the picker: the typed draft should not be
    // auto-saved as an intermediate value — the explicit pick is emitted.
    await user.click(screen.getByTestId("calendar-day-2026-06-20"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-06-20");
  });

  it("does not emit the typed draft when navigating months in-picker", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePickerField value="" onChange={onChange} label="Start date" />);
    await user.click(screen.getByTestId("date-picker-trigger"));
    await user.type(screen.getByTestId("date-picker-input"), "2026-08-15");
    await user.click(screen.getByLabelText("Next month"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
