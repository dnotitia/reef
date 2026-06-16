import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DependencyBadge, DependencyIcon } from "./DependencyBadge";

afterEach(() => {
  cleanup();
});

describe("DependencyBadge", () => {
  it("renders the human label for each direction", () => {
    render(<DependencyBadge dependency="blocked" />);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    cleanup();
    render(<DependencyBadge dependency="blocking" />);
    expect(screen.getByText("Blocking")).toBeInTheDocument();
  });

  it("renders a colored glyph hidden from the a11y tree (label is the name)", () => {
    const { container } = render(<DependencyBadge dependency="blocked" />);
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).not.toHaveAttribute("aria-label");
    expect(icon?.getAttribute("class") ?? "").toContain(
      "text-dependency-blocked",
    );
  });

  it("colors the glyph distinctly per direction", () => {
    const { container: blocked } = render(
      <DependencyBadge dependency="blocked" />,
    );
    expect(blocked.querySelector("svg")?.getAttribute("class") ?? "").toContain(
      "text-dependency-blocked",
    );
    const { container: blocking } = render(
      <DependencyBadge dependency="blocking" />,
    );
    expect(
      blocking.querySelector("svg")?.getAttribute("class") ?? "",
    ).toContain("text-dependency-blocking");
  });

  it("merges a caller className onto the wrapper", () => {
    render(<DependencyBadge dependency="blocking" className="ml-auto" />);
    expect(
      screen.getByText("Blocking").parentElement?.className ?? "",
    ).toContain("ml-auto");
  });
});

describe("DependencyIcon", () => {
  it("exposes an accessible label when not decorative (icon-only use)", () => {
    render(<DependencyIcon dependency="blocked" />);
    const icon = screen.getByRole("img", { name: "Dependency: Blocked" });
    expect(icon).toBeInTheDocument();
    expect(icon).not.toHaveAttribute("aria-hidden");
  });

  it("is hidden from the a11y tree when decorative", () => {
    const { container } = render(
      <DependencyIcon dependency="blocked" decorative />,
    );
    const icon = container.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).not.toHaveAttribute("role");
    expect(icon).not.toHaveAttribute("aria-label");
  });

  it("maps each direction to a distinct glyph", () => {
    const seen = new Set<string>();
    for (const d of ["blocked", "blocking"] as const) {
      const { container } = render(<DependencyIcon dependency={d} />);
      const cls = container.querySelector("svg")?.getAttribute("class") ?? "";
      const lucideClass = cls.split(" ").find((c) => c.startsWith("lucide-"));
      expect(lucideClass).toBeDefined();
      seen.add(lucideClass ?? "");
      cleanup();
    }
    expect(seen.size).toBe(2);
  });
});
