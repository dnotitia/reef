import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DueBadge, DueIcon } from "./DueBadge";

afterEach(() => {
  cleanup();
});

describe("DueBadge", () => {
  it("renders the human label for each due state", () => {
    render(<DueBadge due="overdue" />);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    cleanup();
    render(<DueBadge due="due_soon" />);
    expect(screen.getByText("Due soon")).toBeInTheDocument();
  });

  it("renders a colored glyph hidden from the a11y tree (label is the name)", () => {
    const { container } = render(<DueBadge due="overdue" />);
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).not.toHaveAttribute("aria-label");
    expect(icon?.getAttribute("class") ?? "").toContain("text-due-overdue");
  });

  it("colors the glyph distinctly per due state", () => {
    const { container: overdue } = render(<DueBadge due="overdue" />);
    expect(overdue.querySelector("svg")?.getAttribute("class") ?? "").toContain(
      "text-due-overdue",
    );
    const { container: soon } = render(<DueBadge due="due_soon" />);
    expect(soon.querySelector("svg")?.getAttribute("class") ?? "").toContain(
      "text-due-soon",
    );
  });

  it("merges a caller className onto the wrapper", () => {
    render(<DueBadge due="due_soon" className="ml-auto" />);
    expect(
      screen.getByText("Due soon").parentElement?.className ?? "",
    ).toContain("ml-auto");
  });
});

describe("DueIcon", () => {
  it("exposes an accessible label when not decorative (icon-only use)", () => {
    render(<DueIcon due="overdue" />);
    const icon = screen.getByRole("img", { name: "Due: Overdue" });
    expect(icon).toBeInTheDocument();
    expect(icon).not.toHaveAttribute("aria-hidden");
  });

  it("is hidden from the a11y tree when decorative", () => {
    const { container } = render(<DueIcon due="overdue" decorative />);
    const icon = container.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).not.toHaveAttribute("role");
    expect(icon).not.toHaveAttribute("aria-label");
  });

  it("maps each due state to a distinct glyph", () => {
    const seen = new Set<string>();
    for (const d of ["overdue", "due_soon"] as const) {
      const { container } = render(<DueIcon due={d} />);
      const cls = container.querySelector("svg")?.getAttribute("class") ?? "";
      const lucideClass = cls.split(" ").find((c) => c.startsWith("lucide-"));
      expect(lucideClass).toBeDefined();
      seen.add(lucideClass ?? "");
      cleanup();
    }
    expect(seen.size).toBe(2);
  });
});
