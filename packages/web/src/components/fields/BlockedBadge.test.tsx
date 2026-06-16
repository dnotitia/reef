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
});
