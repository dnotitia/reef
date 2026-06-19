import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageBody } from "./PageBody";

describe("PageBody", () => {
  // This is the runnable done-check for REEF-254: the overscroll-chaining bug is
  // a CSS/layout behavior jsdom cannot measure, so we pin the structural cause
  // instead — the scroll container must declare `overscroll-contain` so a scroll
  // at the body edge is absorbed rather than chaining out to the fixed shell
  // (and dragging the left sidebar) on macOS trackpad/wheel overscroll.
  it("contains overscroll on the scroll container so it cannot chain to the shell", () => {
    const { container } = render(
      <PageBody>
        <p>body content</p>
      </PageBody>,
    );

    const scrollContainer = container.firstElementChild;
    expect(scrollContainer?.className).toContain("overflow-auto");
    expect(scrollContainer?.className).toContain("overscroll-contain");
  });

  it("keeps the existing width, padding, and centering presets", () => {
    const { container } = render(
      <PageBody width="wide" pad="compact" className="flex flex-col gap-4">
        <p>body content</p>
      </PageBody>,
    );

    const inner = container.firstElementChild?.firstElementChild;
    expect(inner?.className).toContain("mx-auto");
    expect(inner?.className).toContain("px-6");
    expect(inner?.className).toContain("max-w-5xl");
    expect(inner?.className).toContain("py-4");
    expect(inner?.className).toContain("flex flex-col gap-4");
  });
});
