import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Calendar } from "./Calendar";

afterEach(() => {
  cleanup();
});

describe("Calendar", () => {
  it("opens on the selected day's month", () => {
    render(
      <Calendar selected="2026-06-15" today="2026-06-09" onSelect={vi.fn()} />,
    );
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    expect(screen.getByText("Mo")).toBeInTheDocument();
  });

  it("marks the selected day with the brand fill token", () => {
    render(
      <Calendar selected="2026-06-15" today="2026-06-09" onSelect={vi.fn()} />,
    );
    const selected = screen.getByTestId("calendar-day-2026-06-15");
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected.className).toContain("bg-brand");
  });

  it("marks today with a brand ring (no fill) via tokens", () => {
    render(
      <Calendar selected="2026-06-15" today="2026-06-09" onSelect={vi.fn()} />,
    );
    const today = screen.getByTestId("calendar-day-2026-06-09");
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today.className).toContain("ring-brand");
    expect(today.className).not.toContain("bg-brand");
  });

  it("calls onSelect with the clicked day's ISO date", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Calendar selected="2026-06-15" today="2026-06-09" onSelect={onSelect} />,
    );
    await user.click(screen.getByTestId("calendar-day-2026-06-20"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("2026-06-20");
  });

  it("pages between months", async () => {
    const user = userEvent.setup();
    render(
      <Calendar selected="2026-06-15" today="2026-06-09" onSelect={vi.fn()} />,
    );
    await user.click(screen.getByLabelText("Next month"));
    expect(screen.getByText("July 2026")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Previous month"));
    await user.click(screen.getByLabelText("Previous month"));
    expect(screen.getByText("May 2026")).toBeInTheDocument();
  });

  it("keeps a tabbable day cell in the new month after paging", async () => {
    const user = userEvent.setup();
    render(
      <Calendar selected="2026-06-15" today="2026-06-09" onSelect={vi.fn()} />,
    );
    expect(screen.getByTestId("calendar-day-2026-06-15")).toHaveAttribute(
      "tabindex",
      "0",
    );
    await user.click(screen.getByLabelText("Next month"));
    // The roving-focus target follows into July so keyboard users can tab in.
    expect(screen.getByTestId("calendar-day-2026-07-15")).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("falls back to today's month when nothing is selected", () => {
    render(<Calendar selected="" today="2026-06-09" onSelect={vi.fn()} />);
    expect(screen.getByText("June 2026")).toBeInTheDocument();
  });
});
