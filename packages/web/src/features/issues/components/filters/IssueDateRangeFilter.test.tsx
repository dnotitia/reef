import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueDateRangeFilter } from "./IssueDateRangeFilter";

afterEach(cleanup);

function renderFilter(
  range?: { field: "updated_at"; from: string; to: string },
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
