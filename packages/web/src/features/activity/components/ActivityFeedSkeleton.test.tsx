import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityFeedSkeleton } from "./ActivityFeed";

afterEach(cleanup);

describe("ActivityFeedSkeleton", () => {
  it("mirrors the loaded feed's chrome so it does not shift on hydration (REEF-258)", () => {
    const { container } = render(<ActivityFeedSkeleton />);

    expect(screen.getByTestId("activity-feed")).toBeInTheDocument();

    // Filter pills (All / AI Drafts / Status Changes) — three rounded-full bars
    // the old skeleton was missing, so the feed shifted down when they appeared.
    expect(
      container.querySelectorAll(".reef-shimmer.rounded-full"),
    ).toHaveLength(3);

    // Card placeholders sized to the loaded cards (~h-32), not the old h-16 rows.
    expect(container.querySelectorAll(".reef-shimmer.h-32")).toHaveLength(3);
    expect(container.querySelectorAll(".reef-shimmer.h-16")).toHaveLength(0);
  });

  it("hides the decorative tree and announces loading to assistive tech (REEF-281)", () => {
    const { container } = render(<ActivityFeedSkeleton />);

    // The placeholder chrome is decorative — aria-hidden so a screen reader
    // skips the empty DOM instead of walking it.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();

    // A sibling role=status (the <output>) carries the loading announcement and
    // must NOT sit under aria-hidden, or assistive tech would never hear it.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading…");
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
  });
});
