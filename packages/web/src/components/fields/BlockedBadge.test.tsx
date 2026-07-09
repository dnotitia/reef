import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BlockedBadge } from "./BlockedBadge";

afterEach(() => {
  cleanup();
});

describe("BlockedBadge", () => {
  it("kanban variant renders 'Blocked' without a count and an uppercase pill", () => {
    render(<BlockedBadge variant="kanban" />);
    const el = screen.getByText("Blocked");
    expect(el).toBeInTheDocument();
    expect(el.className).toContain("uppercase");
    expect(el.className).toContain("bg-destructive/10");
    expect(el.getAttribute("title")).toBe("Blocked");
  });

  it("list variant renders the unresolved blocker count", () => {
    render(<BlockedBadge variant="list" count={3} />);
    expect(screen.getByText("Blocked (3)")).toBeInTheDocument();
  });

  it("merges a caller className (e.g. layout positioning)", () => {
    render(<BlockedBadge variant="kanban" className="ml-auto" />);
    expect(screen.getByText("Blocked").className).toContain("ml-auto");
  });

  it("compact variant encodes the count as glyph + number, no word, with an accessible name", () => {
    render(<BlockedBadge variant="compact" count={2} />);
    // No visible "Blocked (N)" word — the value is encoded once, visually.
    expect(screen.queryByText(/Blocked \(/)).toBeNull();
    // The count is the visible text…
    expect(screen.getByText("2")).toBeInTheDocument();
    // …and the full sentence is the single accessible name (REEF-285).
    expect(screen.getByLabelText("Blocked by 2 issues")).toBeInTheDocument();
  });

  it("compact variant keeps blocked red but lowers the visual emphasis", () => {
    render(<BlockedBadge variant="compact" count={2} />);
    const marker = screen.getByLabelText("Blocked by 2 issues");
    expect(marker.className).toContain("text-destructive/50");
    expect(marker.className).toContain("font-normal");
    expect(marker.className).toContain("text-[10px]");
    expect(marker.className).not.toContain("text-muted-foreground");
    expect(marker.querySelector("svg")?.getAttribute("class") ?? "").toContain(
      "size-2.5",
    );
  });

  it("compact variant singularizes one blocker and clamps large counts", () => {
    const { rerender } = render(<BlockedBadge variant="compact" count={1} />);
    expect(screen.getByLabelText("Blocked by 1 issue")).toBeInTheDocument();

    rerender(<BlockedBadge variant="compact" count={12} />);
    expect(screen.getByText("9+")).toBeInTheDocument();
  });
});
