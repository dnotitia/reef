import { afterEach, describe, expect, it } from "vitest";
import {
  computePanelPlacement,
  findScrollBoundaryRect,
} from "./panelPlacement";

afterEach(() => {
  document.body.innerHTML = "";
});

const VIEWPORT = { width: 1000, height: 800 };

/** Trigger 200px wide, placed at (left, top) with a fixed 32px height. */
function triggerAt(left: number, top: number, width = 200) {
  return { left, right: left + width, top, bottom: top + 32 };
}

describe("computePanelPlacement", () => {
  it("opens down + start by default when the panel fits below and to the right", () => {
    expect(
      computePanelPlacement({
        trigger: triggerAt(100, 100),
        panel: { width: 240, height: 256 },
        viewport: VIEWPORT,
      }),
    ).toEqual({ vertical: "down", horizontal: "start" });
  });

  it("flips up when there is no room below but more room above", () => {
    // Trigger near the bottom: just 60px below, ~708px above.
    const result = computePanelPlacement({
      trigger: triggerAt(100, 708),
      panel: { width: 240, height: 256 },
      viewport: VIEWPORT,
    });
    expect(result.vertical).toBe("up");
  });

  it("uses a scroll boundary instead of the full viewport when provided", () => {
    // The viewport still has room below, but the containing scroll panel ends
    // just under the trigger, so a non-portaled panel should open upward.
    const result = computePanelPlacement({
      trigger: triggerAt(100, 460),
      panel: { width: 240, height: 256 },
      viewport: { width: 1000, height: 900 },
      boundary: { top: 100, bottom: 520, left: 0, right: 1000 },
    });
    expect(result.vertical).toBe("up");
  });

  it("intersects a scroll boundary with the viewport", () => {
    // The scroll panel extends beyond the viewport, but the visible viewport
    // still ends right under the trigger.
    const result = computePanelPlacement({
      trigger: triggerAt(100, 760),
      panel: { width: 240, height: 256 },
      viewport: VIEWPORT,
      boundary: { top: 0, bottom: 1200, left: 0, right: 1000 },
    });
    expect(result.vertical).toBe("up");
  });

  it("stays down when neither side has room, preferring the natural direction", () => {
    // A panel taller than the viewport: below is cramped but above is too.
    const result = computePanelPlacement({
      trigger: triggerAt(100, 380),
      panel: { width: 240, height: 900 },
      viewport: VIEWPORT,
    });
    expect(result.vertical).toBe("down");
  });

  it("flips a start-anchored panel to end when it would overflow the right edge", () => {
    // Trigger hugs the right edge; a 240px start-anchored panel runs off-screen
    // (800 + 240 = 1040 > 992), but end-anchored it fits (1000 - 240 = 760 >= 8).
    const result = computePanelPlacement({
      trigger: triggerAt(800, 100, 200), // right = 1000
      panel: { width: 240, height: 200 },
      viewport: VIEWPORT,
      preferredHorizontal: "start",
    });
    expect(result.horizontal).toBe("end");
  });

  it("keeps a preferred end anchor (does not flip back) when it still fits", () => {
    const result = computePanelPlacement({
      trigger: triggerAt(700, 100, 200), // right = 900
      panel: { width: 240, height: 200 },
      viewport: VIEWPORT,
      preferredHorizontal: "end",
    });
    expect(result.horizontal).toBe("end");
  });

  it("does NOT flip a wide panel to a side that would overflow off-screen (REEF-134)", () => {
    // Preferred start overflows right (400 + 600 = 1000 > 992), but end would
    // overflow LEFT too (right - width = 600 - 600 = 0 < margin) → keep start,
    // does not trade one overflow for another.
    const result = computePanelPlacement({
      trigger: triggerAt(400, 100, 200), // right = 600
      panel: { width: 600, height: 200 },
      viewport: VIEWPORT,
      preferredHorizontal: "start",
    });
    expect(result.horizontal).toBe("start");
  });

  it("returns the preferred placement unchanged for an unmeasured (width 0) panel", () => {
    // jsdom / pre-paint: every rect is 0. Nothing may flip on a guess.
    expect(
      computePanelPlacement({
        trigger: { top: 0, bottom: 0, left: 0, right: 0 },
        panel: { width: 0, height: 0 },
        viewport: VIEWPORT,
        preferredHorizontal: "end",
      }),
    ).toEqual({ vertical: "down", horizontal: "end" });
  });

  it("finds the nearest clipping or scrolling ancestor as a boundary", () => {
    const outer = document.createElement("div");
    outer.style.overflowY = "auto";
    outer.getBoundingClientRect = () => new DOMRect(10, 20, 300, 400);

    const middle = document.createElement("div");
    const trigger = document.createElement("button");
    middle.append(trigger);
    outer.append(middle);
    document.body.append(outer);

    expect(findScrollBoundaryRect(trigger)).toEqual({
      top: 20,
      bottom: 420,
      left: 10,
      right: 310,
    });
  });
});
