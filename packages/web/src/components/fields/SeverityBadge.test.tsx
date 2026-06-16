import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SeverityBadge, SeverityIcon } from "./SeverityBadge";

afterEach(() => {
  cleanup();
});

describe("SeverityBadge", () => {
  it("renders the human label for the severity", () => {
    render(<SeverityBadge severity="blocker" />);
    expect(screen.getByText("Blocker")).toBeInTheDocument();
  });

  it("renders a per-severity colored glyph hidden from the a11y tree", () => {
    const { container } = render(<SeverityBadge severity="critical" />);
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    // The visible label is the single accessible name, so the glyph is decorative.
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).not.toHaveAttribute("aria-label");
    expect(icon?.getAttribute("class") ?? "").toContain(
      "text-severity-critical",
    );
  });

  it("colors the glyph distinctly per severity", () => {
    const { container: blocker } = render(<SeverityBadge severity="blocker" />);
    expect(blocker.querySelector("svg")?.getAttribute("class") ?? "").toContain(
      "text-severity-blocker",
    );
    const { container: trivial } = render(<SeverityBadge severity="trivial" />);
    expect(trivial.querySelector("svg")?.getAttribute("class") ?? "").toContain(
      "text-severity-trivial",
    );
  });

  it("merges a caller className onto the wrapper", () => {
    render(<SeverityBadge severity="major" className="ml-auto" />);
    expect(screen.getByText("Major").parentElement?.className ?? "").toContain(
      "ml-auto",
    );
  });
});

describe("SeverityIcon", () => {
  it("exposes an accessible label when not decorative (icon-only use)", () => {
    render(<SeverityIcon severity="minor" />);
    const icon = screen.getByRole("img", { name: "Severity: Minor" });
    expect(icon).toBeInTheDocument();
    expect(icon).not.toHaveAttribute("aria-hidden");
  });

  it("is hidden from the a11y tree when decorative", () => {
    const { container } = render(<SeverityIcon severity="minor" decorative />);
    const icon = container.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).not.toHaveAttribute("role");
    expect(icon).not.toHaveAttribute("aria-label");
  });

  it("maps each ordinal level to a distinct glyph", () => {
    const seen = new Set<string>();
    for (const s of [
      "blocker",
      "critical",
      "major",
      "minor",
      "trivial",
    ] as const) {
      const { container } = render(<SeverityIcon severity={s} />);
      const cls = container.querySelector("svg")?.getAttribute("class") ?? "";
      const lucideClass = cls.split(" ").find((c) => c.startsWith("lucide-"));
      expect(lucideClass).toBeDefined();
      seen.add(lucideClass ?? "");
      cleanup();
    }
    expect(seen.size).toBe(5);
  });
});
