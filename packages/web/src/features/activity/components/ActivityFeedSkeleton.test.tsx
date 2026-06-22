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
});
