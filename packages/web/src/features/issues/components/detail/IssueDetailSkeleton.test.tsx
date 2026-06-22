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

  it("aligns the rail label gutter to IssueFieldRow's w-20, not the old w-12 (REEF-258)", () => {
    const { container } = render(<IssueDetailSkeleton />);
    // The rail's property rows mirror IssueFieldRow, whose label gutter is w-20.
    // A w-12 gutter shifted the value column ~32px right on hydration.
    const gutters = container.querySelectorAll(".reef-shimmer.w-20.shrink-0");
    // Details (4) + People (3) + Planning (6) rows each carry one gutter.
    expect(gutters).toHaveLength(13);
    expect(
      container.querySelectorAll(".reef-shimmer.w-12.shrink-0"),
    ).toHaveLength(0);
  });

  it("reserves the description, relationships and activity regions so the panel does not double on hydration (REEF-258)", () => {
    const { container } = render(<IssueDetailSkeleton />);
    // Description reserves the MarkdownEditor's ~236px height (h-60), not the
    // old short h-44 stub.
    expect(container.querySelectorAll(".reef-shimmer.h-60")).toHaveLength(1);
    expect(container.querySelectorAll(".reef-shimmer.h-44")).toHaveLength(0);
    // Activity composer (h-20) + its three event rows (h-12) are reserved below
    // the relationships section, which the old skeleton omitted entirely.
    expect(container.querySelectorAll(".reef-shimmer.h-20")).toHaveLength(1);
    expect(container.querySelectorAll(".reef-shimmer.h-12")).toHaveLength(3);
  });
});
