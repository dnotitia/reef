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
    for (const label of [
      "Title",
      "Description",
      "Details",
      "People",
      "Planning",
      "Parent",
      "Relationships",
      "Activity",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("keeps value placeholders in one monotonic reading-order sweep", () => {
    const { container } = render(<IssueDetailSkeleton />);
    const indices = placeholders(container).map((el) =>
      Number(el.style.getPropertyValue("--i")),
    );
    // Fixed labels are no longer painted over bars. Value placeholders retain
    // their DOM reading order, so the sweep remains monotonic without requiring
    // label slots to carry decorative shimmer.
    const sorted = [...indices].sort((a, b) => a - b);
    expect(sorted).toEqual(indices);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("keeps fixed labels as normal text and reserves shimmer for values", () => {
    const { container } = render(<IssueDetailSkeleton />);
    const all = placeholders(container);
    const primary = all.filter(
      (el) => el.getAttribute("data-tone") === "primary",
    );
    expect(
      container.querySelectorAll('.reef-shimmer[data-tone="secondary"]'),
    ).toHaveLength(0);
    expect(primary.length).toBeGreaterThan(0);
    expect(primary.some((el) => el.className.includes("h-8"))).toBe(true);
  });

  it("aligns the rail label gutter to IssueFieldRow's w-20, not the old w-12 (REEF-258)", () => {
    const { container } = render(<IssueDetailSkeleton />);
    // The rail's property rows mirror IssueFieldRow, whose label gutter is w-20.
    // A w-12 gutter shifted the value column ~32px right on hydration.
    const gutters = container.querySelectorAll("span.w-20.shrink-0.text-xs");
    // Details (4) + People (3) + Planning (6) + Parent (1) + Relations (3)
    // rows each carry one gutter.
    expect(gutters).toHaveLength(17);
    expect(container.querySelectorAll("span.w-12.shrink-0")).toHaveLength(0);
  });

  it("reserves the description, lower main sections and activity regions so the panel does not double on hydration (REEF-258)", () => {
    const { container } = render(<IssueDetailSkeleton />);
    // Description reserves the MarkdownEditor's ~356px height (320px frame +
    // toolbar), not the old short stub.
    expect(
      container.querySelectorAll(".reef-shimmer.h-\\[356px\\]"),
    ).toHaveLength(1);
    expect(container.querySelectorAll(".reef-shimmer.h-44")).toHaveLength(0);
    // Activity composer (h-20) + its three event rows (h-12) are reserved below
    // Sub-issues / linked documents / refs, which the old skeleton omitted.
    expect(container.querySelectorAll(".reef-shimmer.h-20")).toHaveLength(1);
    expect(container.querySelectorAll(".reef-shimmer.h-12")).toHaveLength(3);
  });

  it("hides the decorative panel and announces loading to assistive tech (REEF-281)", () => {
    const { container } = render(<IssueDetailSkeleton />);

    // Every placeholder bar is decorative — aria-hidden individually, while
    // fixed field and section labels stay in the accessibility tree.
    expect(
      container.querySelector('.reef-shimmer[aria-hidden="true"]'),
    ).not.toBeNull();
    expect(
      screen.getByText("Details").closest('[aria-hidden="true"]'),
    ).toBeNull();

    // The role=status loading announcement is a sibling, not under aria-hidden.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading…");
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
  });
});
