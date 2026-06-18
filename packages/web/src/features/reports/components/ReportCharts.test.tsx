import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RiskBucket } from "../lib/aggregate";
import { RankedBarList, RiskMatrix } from "./ReportCharts";

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
      // The grow-in transition is gated on motion-safe so reduced-motion users
      // get the final bar with no animation (REEF-248 AC4).
      expect(bar.className).toContain("motion-safe:transition-transform");
      expect(bar.className).not.toContain("transition-[width]");
      expect(bar.style.width).not.toMatch(/%/);
    }
  });

  it("colors value bars with brand only — no per-row identity fill (REEF-248 AC1)", () => {
    const { container } = render(
      <RankedBarList
        rows={[
          { key: "a", label: "Alpha", value: 5 },
          { key: "b", label: "Beta", value: 10 },
        ]}
      />,
    );
    // Every value bar uses the single brand value-token; no semantic/identity
    // color leaks into a ranked breakdown.
    expect(
      container.querySelectorAll("[style*='var(--brand)']").length,
    ).toBeGreaterThan(0);
    for (const token of ["--ai", "--priority", "--status", "--type"]) {
      expect(container.querySelector(`[style*='${token}']`)).toBeNull();
    }
  });
});

describe("RiskMatrix (REEF-248 AC3/AC4)", () => {
  const buckets: RiskBucket[] = [
    { priority: "critical", aging: "stalled", count: 4 },
    { priority: "low", aging: "fresh", count: 1 },
  ];

  it("renders a semantic table with column + row headers (parity with the Pivot)", () => {
    const { container } = render(<RiskMatrix buckets={buckets} />);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    // 4 aging columns as <th scope=col>, 5 priority rows as <th scope=row>.
    expect(table?.querySelectorAll("th[scope='col']")).toHaveLength(4);
    expect(table?.querySelectorAll("th[scope='row']")).toHaveLength(5);
    // A screen-reader caption describes the two axes.
    expect(table?.querySelector("caption")?.textContent).toMatch(/priority/i);
  });

  it("fills cells with the neutral density ramp, not a red risk tint (REEF-248 AC1)", () => {
    const { container } = render(<RiskMatrix buckets={buckets} />);
    // Populated cells carry the shared neutral heat ramp...
    expect(
      container.querySelectorAll("td[style*='--muted-foreground']").length,
    ).toBeGreaterThan(0);
    // ...and not the destructive/brand fills the old hot/cool ramp used.
    expect(container.querySelector("td[style*='--destructive']")).toBeNull();
    expect(container.querySelector("td[style*='var(--brand)']")).toBeNull();
  });
});
