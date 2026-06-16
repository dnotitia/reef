import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DateDisplay } from "./DateDisplay";

afterEach(() => {
  cleanup();
});

describe("DateDisplay", () => {
  it("iso format renders YYYY-MM-DD as plain text", () => {
    const { container } = render(
      <DateDisplay date="2026-06-01T08:00:00Z" emptyText="—" />,
    );
    expect(container.textContent).toBe("2026-06-01");
    // plain variant emits no wrapping span
    expect(container.querySelector("span")).toBeNull();
  });

  it("preserves the stored calendar date for offset ISO strings", () => {
    const { container, rerender } = render(
      <DateDisplay date="2026-06-01T00:30:00+09:00" emptyText="—" />,
    );
    expect(container.textContent).toBe("2026-06-01");

    rerender(<DateDisplay date="2026-06-01T00:30:00+09:00" format="short" />);
    expect(container.textContent).toBe("06-01");
  });

  it("does not normalize invalid ISO-looking stored dates", () => {
    const { container, rerender } = render(
      <DateDisplay date="2026-02-30T00:00:00Z" emptyText="—" />,
    );
    expect(container.textContent).toBe("2026-02-30");

    rerender(<DateDisplay date="2026-02-30T00:00:00Z" format="short" />);
    expect(container.textContent).toBe("02-30");
  });

  it("renders emptyText when there is no date", () => {
    const { container } = render(<DateDisplay date={null} emptyText="—" />);
    expect(container.textContent).toBe("—");
  });

  it("renders nothing when empty and no emptyText", () => {
    const { container } = render(<DateDisplay date={undefined} />);
    expect(container.textContent).toBe("");
  });

  it("short+label renders the labelled MM-DD card span", () => {
    render(
      <DateDisplay
        date="2026-06-01"
        format="short"
        label="S"
        titlePrefix="Start"
      />,
    );
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.getByText(/06-01/)).toBeInTheDocument();
    expect(screen.getByTitle("Start 2026-06-01")).toBeInTheDocument();
  });

  it("overdue applies the destructive pill classes", () => {
    render(
      <DateDisplay
        date="2026-06-01"
        format="short"
        label="D"
        titlePrefix="Due"
        overdue
      />,
    );
    const span = screen.getByTitle("Due 2026-06-01");
    expect(span.className).toContain("bg-destructive/10");
    expect(span.className).toContain("text-destructive");
  });

  it("non-overdue card span carries no class attribute", () => {
    render(<DateDisplay date="2026-06-01" format="short" label="S" />);
    expect(
      screen.getByText("S").parentElement?.getAttribute("class"),
    ).toBeNull();
  });
});
