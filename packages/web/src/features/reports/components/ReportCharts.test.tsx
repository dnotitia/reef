import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RankedBarList } from "./ReportCharts";

afterEach(cleanup);

describe("RankedBarList composited bars (REEF-097 AC3)", () => {
  it("grows bars with a transform: scaleX off a full-width track, not by animating width", () => {
    const { container } = render(
      <RankedBarList
        rows={[
          { key: "a", label: "Alpha", value: 5 },
          { key: "b", label: "Beta", value: 10 },
        ]}
      />,
    );

    const bars = Array.from(
      container.querySelectorAll<HTMLElement>("[style*='scaleX']"),
    );
    expect(bars).toHaveLength(2);

    // value/max → scaleX factor (5/10, 10/10), full-width track + left origin.
    expect(bars[0].style.transform).toBe("scaleX(0.5)");
    expect(bars[1].style.transform).toBe("scaleX(1)");
    for (const bar of bars) {
      expect(bar.className).toContain("w-full");
      expect(bar.className).toContain("origin-left");
      expect(bar.className).toContain("transition-transform");
      expect(bar.className).not.toContain("transition-[width]");
      expect(bar.style.width).not.toMatch(/%/);
    }
  });
});
