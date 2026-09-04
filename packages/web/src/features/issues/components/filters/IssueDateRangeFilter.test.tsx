import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IssueDateRange } from "@reef/core";
import { IssueDateRangeFilter } from "./IssueDateRangeFilter";

afterEach(cleanup);

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

function renderFilter(
  range?: IssueDateRange,
  onChange = vi.fn(),
  locale: "en" | "ko" = "en",
) {
  render(
    <IntlTestProvider locale={locale}>
      <IssueDateRangeFilter range={range} onChange={onChange} />
    </IntlTestProvider>,
  );
  return onChange;
}

describe("IssueDateRangeFilter", () => {
  it("renders one inactive compound trigger without bound controls", () => {
    renderFilter();

    const group = screen.getByTestId("updated-at-filter");
    expect(group).not.toHaveAttribute("data-active");
    expect(screen.getByTestId("updated-at-filter-trigger")).toHaveTextContent(
      "Updated date",
    );
    expect(screen.queryByTestId("date-picker-trigger")).toBeNull();
    expect(screen.queryByTestId("updated-at-range-clear")).toBeNull();
  });

  it("shows one active summary and one editor with persistent bound labels", async () => {
    const user = userEvent.setup();
    renderFilter({
      field: "updated_at",
      from: "2026-06-01",
      to: "2026-06-02",
    });

    const group = screen.getByTestId("updated-at-filter");
    expect(group).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("updated-at-filter-summary")).toHaveTextContent(
      "Updated date · Jun 1, 2026 → Jun 2, 2026",
    );
    expect(screen.getByTestId("updated-at-range-clear")).toBeVisible();

    await user.click(screen.getByTestId("updated-at-filter-trigger"));
    const editor = screen.getByTestId("updated-at-range-editor");
    expect(editor).toBeVisible();
    expect(
      screen.getByTestId("updated-at-range-editor-criterion"),
    ).toHaveTextContent("Updated date");
    expect(
      screen.getByTestId("updated-at-range-start-label"),
    ).toHaveTextContent("Start date");
    expect(screen.getByTestId("updated-at-range-end-label")).toHaveTextContent(
      "End date",
    );
    expect(
      editor.querySelectorAll('[data-testid="date-picker-trigger"]'),
    ).toHaveLength(2);
    expect(
      editor.querySelector('[data-testid="date-picker-clear"]'),
    ).toBeNull();
    expect(screen.getByTestId("updated-at-range-editor-clear")).toBeVisible();
    expect(
      screen
        .getByTestId("updated-at-range-editor-criterion")
        .querySelector("button"),
    ).toBeNull();
  });

  it("switches the single date criterion without changing the range shape", async () => {
    const user = userEvent.setup();
    const onChange = renderFilter({
      field: "updated_at",
      from: "2026-06-01",
      to: "2026-06-02",
    });

    await user.click(screen.getByTestId("updated-at-filter-trigger"));
    const field = screen.getByRole("combobox", { name: "Date field" });
    expect(field).toHaveTextContent("Updated date");

    await user.click(field);
    expect(screen.getByRole("option", { name: "Created date" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Start date" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Due date" })).toBeVisible();
    await user.click(screen.getByRole("option", { name: "Created date" }));

    expect(onChange).toHaveBeenCalledWith({
      field: "created_at",
      from: "2026-06-01",
      to: "2026-06-02",
    });
    expect(screen.getByTestId("updated-at-range-editor")).toBeVisible();
    expect(field).toHaveFocus();
  });

  it("uses the shared Select trigger for the date criterion", async () => {
    const user = userEvent.setup();
    renderFilter({
      field: "updated_at",
      from: "2026-06-01",
      to: "2026-06-02",
    });

    await user.click(screen.getByTestId("updated-at-filter-trigger"));

    const field = screen.getByTestId("issue-date-range-field");
    expect(field).toHaveAttribute("data-slot", "select-trigger");
    expect(field.tagName).not.toBe("SELECT");
  });

  it("supports keyboard dismissal without closing the outer date editor", async () => {
    const user = userEvent.setup();
    const onChange = renderFilter({
      field: "updated_at",
      from: "2026-06-01",
      to: "2026-06-02",
    });

    await user.click(screen.getByTestId("updated-at-filter-trigger"));
    const field = screen.getByTestId("issue-date-range-field");
    field.focus();
    await user.keyboard("{Enter}");

    const listbox = await screen.findByRole("listbox");
    expect(document.activeElement).toBeInstanceOf(HTMLElement);
    expect(listbox).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(onChange).toHaveBeenCalledWith({
      field: "created_at",
      from: "2026-06-01",
      to: "2026-06-02",
    });
    expect(screen.getByTestId("updated-at-range-editor")).toBeVisible();
    expect(field).toHaveFocus();

    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("updated-at-range-editor")).toBeVisible();
    expect(field).toHaveFocus();
  });

  it("uses the selected criterion in the trigger and accessible names", async () => {
    const user = userEvent.setup();
    renderFilter({
      field: "due_date",
      from: "2026-06-01",
      to: "2026-06-02",
    });

    const trigger = screen.getByTestId("updated-at-filter-trigger");
    expect(trigger).toHaveTextContent("Due date · Jun 1, 2026 → Jun 2, 2026");
    expect(trigger).toHaveAccessibleName(
      "Due date · Jun 1, 2026 → Jun 2, 2026",
    );
    expect(screen.getByTestId("updated-at-range-clear")).toHaveAccessibleName(
      "Clear Due date range",
    );
    await user.click(trigger);
    expect(
      screen.getByTestId("updated-at-range-editor-criterion"),
    ).toHaveTextContent("Due date");
  });

  it("localizes the compound summary and editor labels in Korean", async () => {
    const user = userEvent.setup();
    renderFilter(
      { field: "updated_at", from: "2026-06-01", to: "2026-06-02" },
      vi.fn(),
      "ko",
    );

    expect(screen.getByTestId("updated-at-filter-summary")).toHaveTextContent(
      "수정일 · 2026년 6월 1일 → 2026년 6월 2일",
    );
    await user.click(screen.getByTestId("updated-at-filter-trigger"));
    expect(
      screen.getByTestId("updated-at-range-start-label"),
    ).toHaveTextContent("시작일");
    expect(screen.getByTestId("updated-at-range-end-label")).toHaveTextContent(
      "종료일",
    );
  });

  it("keeps incomplete and reversed errors next to the edited end field", async () => {
    const user = userEvent.setup();
    renderFilter({ field: "updated_at", from: "2026-06-03", to: "" });
    await user.click(screen.getByTestId("updated-at-filter-trigger"));
    expect(screen.getByTestId("updated-at-range-end-error")).toHaveTextContent(
      "Choose an end date.",
    );
    cleanup();

    renderFilter({
      field: "updated_at",
      from: "2026-06-03",
      to: "2026-06-02",
    });
    await user.click(screen.getByTestId("updated-at-filter-trigger"));
    expect(screen.getByTestId("updated-at-range-end-error")).toHaveTextContent(
      "End date must be on or after the start date.",
    );
  });

  it("clears the whole range from either group-level action", async () => {
    const user = userEvent.setup();
    const onChange = renderFilter({
      field: "updated_at",
      from: "2026-06-01",
      to: "2026-06-02",
    });

    await user.click(screen.getByTestId("updated-at-range-clear"));
    expect(onChange).toHaveBeenCalledWith(undefined);
    onChange.mockClear();

    await user.click(screen.getByTestId("updated-at-filter-trigger"));
    await user.click(screen.getByTestId("updated-at-range-editor-clear"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
