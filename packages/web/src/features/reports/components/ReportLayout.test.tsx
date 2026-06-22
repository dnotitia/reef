import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReportsSkeleton } from "./ReportLayout";

afterEach(cleanup);

describe("ReportsSkeleton", () => {
  it("reserves the scope bar, the 8-tile KPI grid, and the three section bands (REEF-258)", () => {
    const { container } = render(<ReportsSkeleton />);

    // Scope bar — eight control placeholders (one per ReportScopeBar control),
    // each a full-width h-8 bar. The old skeleton omitted the bar entirely, so
    // the whole page dropped a row when it appeared.
    expect(container.querySelectorAll(".reef-shimmer.h-8.w-full")).toHaveLength(
      8,
    );

    // KPI grid — the loaded HealthSummary is lg:grid-cols-5 with 8 tiles (was
    // lg:grid-cols-6 × 6: one row vs the real two).
    const kpiGrid = container.querySelector(".lg\\:grid-cols-5");
    expect(kpiGrid).not.toBeNull();
    expect(kpiGrid?.children).toHaveLength(8);

    // Three labeled bands, rendered with their real (static) headings so they
    // stay pixel-identical across the skeleton↔loaded swap.
    expect(
      screen.getByRole("heading", { name: "Snapshot" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Flow & forecast" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Breakdown" }),
    ).toBeInTheDocument();
  });
});
