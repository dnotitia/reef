import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IssueDetailSkeleton } from "./IssueDetailSkeleton";

afterEach(cleanup);

function placeholders(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".reef-shimmer"));
}

describe("IssueDetailSkeleton", () => {
  it("renders the mirrored detail skeleton", () => {
    render(<IssueDetailSkeleton />);
    expect(screen.getByTestId("issue-detail-skeleton")).toBeInTheDocument();
  });

  it("phases every placeholder into one sweep with gap-free reading-order indices", () => {
    const { container } = render(<IssueDetailSkeleton />);
    const indices = placeholders(container).map((el) =>
      Number(el.style.getPropertyValue("--i")),
    );
    // A single light source needs one monotonic position scale across the whole
    // panel — every bar gets a distinct `--i` and they fill 0..n-1 with no gaps,
    // so the sweep travels in reading order instead of bars blinking in lockstep.
    const sorted = [...indices].sort((a, b) => a - b);
    expect(sorted).toEqual(indices.map((_, i) => i));
  });

  it("gives labels and section headers the fainter secondary tone, values the primary tone", () => {
    const { container } = render(<IssueDetailSkeleton />);
    const all = placeholders(container);
    const secondary = all.filter(
      (el) => el.getAttribute("data-tone") === "secondary",
    );
    const primary = all.filter(
      (el) => el.getAttribute("data-tone") === "primary",
    );
    // Both tones are in play (the two-tone hierarchy, AC2)...
    expect(secondary.length).toBeGreaterThan(0);
    expect(primary.length).toBeGreaterThan(0);
    // ...and the short label gutters (h-3) are the secondary ones while the
    // taller value placeholders stay primary.
    for (const el of secondary) {
      expect(el.className).toContain("h-3");
    }
    expect(primary.some((el) => el.className.includes("h-8"))).toBe(true);
  });
});
