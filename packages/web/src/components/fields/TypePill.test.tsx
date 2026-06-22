import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TypePill } from "./TypePill";

afterEach(() => {
  cleanup();
});

describe("TypePill", () => {
  it("renders the human label for the type", () => {
    render(<TypePill type="bug" variant="list" />);
    expect(screen.getByText("Bug")).toBeInTheDocument();
  });

  it("falls back to Task when type is null/undefined", () => {
    render(<TypePill type={null} />);
    expect(screen.getByText("Task")).toBeInTheDocument();
  });

  // The label sits in its own span (so a caller can hide it responsively —
  // REEF-285); the variant chrome lives on the pill wrapper, i.e. its parent.
  it("applies the kanban variant classes verbatim", () => {
    render(<TypePill type="story" variant="kanban" />);
    const el = screen.getByText("Story").parentElement as HTMLElement;
    expect(el.className).toContain("rounded-sm");
    expect(el.className).toContain("bg-surface-subtle");
    expect(el.className).toContain("text-[10px]");
  });

  it("applies the list variant classes verbatim", () => {
    render(<TypePill type="story" variant="list" />);
    const el = screen.getByText("Story").parentElement as HTMLElement;
    expect(el.className).toContain("rounded-full");
    expect(el.className).toContain("bg-secondary");
    expect(el.className).toContain("text-[11px]");
  });

  it("applies the activity variant classes verbatim", () => {
    render(<TypePill type="epic" variant="activity" />);
    const el = screen.getByText("Epic").parentElement as HTMLElement;
    expect(el.className).toContain("bg-background/70");
  });

  it("renders the badge variant chrome-less for dropdown rows", () => {
    render(<TypePill type="bug" variant="badge" />);
    const el = screen.getByText("Bug").parentElement as HTMLElement;
    // No chip chrome — the dropdown row reads as bare glyph + label, matching
    // the StatusBadge / PriorityBadge / SeverityBadge leaves beside it.
    expect(el.className).not.toContain("rounded-full");
    expect(el.className).not.toContain("border");
    expect(el.className).not.toContain("bg-secondary");
    expect(el.className).toContain("text-foreground/80");
  });

  it("merges a caller className", () => {
    render(<TypePill type="task" variant="kanban" className="ml-auto" />);
    expect(
      (screen.getByText("Task").parentElement as HTMLElement).className,
    ).toContain("ml-auto");
  });

  it("applies labelClassName to the label span only (responsive hide)", () => {
    render(
      <TypePill
        type="story"
        variant="list"
        labelClassName="@max-[16rem]:hidden"
      />,
    );
    const label = screen.getByText("Story");
    // The hide class is on the label, not the pill wrapper, so the glyph stays.
    expect(label.className).toContain("@max-[16rem]:hidden");
    expect((label.parentElement as HTMLElement).className).not.toContain(
      "@max-[16rem]:hidden",
    );
  });

  it("renders a per-type colored glyph hidden from the a11y tree", () => {
    const { container } = render(<TypePill type="bug" variant="list" />);
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    // Color is redundant with the label, so the glyph is decorative.
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon?.getAttribute("class") ?? "").toContain("text-type-bug");
  });

  it("colors the glyph distinctly per type", () => {
    const { container: epic } = render(<TypePill type="epic" variant="list" />);
    expect(epic.querySelector("svg")?.getAttribute("class") ?? "").toContain(
      "text-type-epic",
    );
    const { container: story } = render(
      <TypePill type="story" variant="list" />,
    );
    expect(story.querySelector("svg")?.getAttribute("class") ?? "").toContain(
      "text-type-story",
    );
  });
});
