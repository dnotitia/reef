import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  type ReportAggregates,
  type StatusCount,
  computeAggregates,
} from "../lib/aggregate";
import {
  DeadlineCard,
  HealthSummary,
  NamedRows,
  StatusFunnel,
} from "./ReportSummarySections";

// An all-zero aggregate is the cheapest way to obtain a fully-typed
// ReportAggregates; each test overrides the slice it asserts on.
const base = computeAggregates([]);

describe("ReportSummarySections — single-home metrics (REEF-192)", () => {
  it("HealthSummary drops the completion-% hints and the net-throughput tile", () => {
    const agg: ReportAggregates = {
      ...base,
      total: 10,
      kpis: { ...base.kpis, active: 10, inProgress: 1, done: 4 },
      riskSummary: { ...base.riskSummary, netThroughput: 5 },
    };

    render(<HealthSummary agg={agg} />);

    // completion = round(4 / 10 * 100) = 40%, now owned solely by the Workflow
    // "Completion" header — the Active/Done KPI hints no longer echo it.
    expect(screen.queryByText("40% done")).not.toBeInTheDocument();
    expect(screen.queryByText("40%")).not.toBeInTheDocument();
    // Net throughput is owned by the Throughput card subtitle.
    expect(screen.queryByText("Net throughput")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kpi-net-throughput")).not.toBeInTheDocument();
    // The remaining tiles still render their own values.
    expect(
      within(screen.getByTestId("kpi-active")).getByText("10"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("kpi-done")).getByText("4"),
    ).toBeInTheDocument();
  });

  it("StatusFunnel keeps Completion + WIP but drops the duplicate Review queue line", () => {
    // Completion / WIP are derived from the rows themselves: done+closed = 4 of
    // 10 → 40%, in_progress+in_review = 3 of 10 → 30% (REEF-188).
    const byStatus: StatusCount[] = [
      { status: "backlog", count: 0, points: 0 },
      { status: "todo", count: 3, points: 0 },
      { status: "in_progress", count: 1, points: 0 },
      { status: "in_review", count: 2, points: 0 },
      { status: "done", count: 4, points: 0 },
      { status: "closed", count: 0, points: 0 },
    ];

    render(<StatusFunnel rows={byStatus} />);

    // Completion is the single home for the done ratio.
    expect(screen.getByText("Completion")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    // WIP is a distinct ratio, not echoed by the funnel, so it stays.
    expect(screen.getByText("WIP")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    // The in-review count lives in the funnel legend; the "Review queue"
    // MetricLine that repeated it is gone.
    expect(screen.queryByText("Review queue")).not.toBeInTheDocument();
  });

  it("StatusFunnel weights Completion + WIP by story points when measured by points (REEF-188)", () => {
    // Same issue distribution, but points are concentrated in done + WIP:
    // done+closed = 8 of 20 pts → 40%; in_progress+in_review = 9 of 20 → 45%.
    const byStatus: StatusCount[] = [
      { status: "backlog", count: 0, points: 0 },
      { status: "todo", count: 3, points: 3 },
      { status: "in_progress", count: 1, points: 5 },
      { status: "in_review", count: 2, points: 4 },
      { status: "done", count: 4, points: 8 },
      { status: "closed", count: 0, points: 0 },
    ];

    render(<StatusFunnel rows={byStatus} measure="points" />);

    expect(screen.getByText("40%")).toBeInTheDocument(); // 8 / 20 points done
    expect(screen.getByText("45%")).toBeInTheDocument(); // 9 / 20 points WIP
  });

  it("NamedRows renders the count or the points value per the active measure (REEF-188)", () => {
    const rows = [
      { name: "alice", count: 2, points: 13 },
      { name: "bob", count: 5, points: 3 },
    ];

    const counted = render(<NamedRows rows={rows} />);
    const aliceCount = counted
      .getAllByTestId("named-row")
      .find((el) => el.dataset.name === "alice");
    expect(aliceCount?.dataset.value).toBe("2");
    expect(
      within(aliceCount as HTMLElement).getByText("2"),
    ).toBeInTheDocument();
    counted.unmount();

    render(<NamedRows rows={rows} measure="points" />);
    // The same alice row now reads its summed points, not its issue count.
    const aliceRow = screen
      .getAllByTestId("named-row")
      .find((el) => el.dataset.name === "alice");
    expect(aliceRow?.dataset.value).toBe("13");
    expect(within(aliceRow as HTMLElement).getByText("13")).toBeInTheDocument();
  });

  it("DeadlineCard renders each bucket once via the legend, undated only in the subtitle", () => {
    const agg: ReportAggregates = {
      ...base,
      dueHealth: { overdue: 2, dueThisWeek: 1, upcoming: 3, noDueDate: 5 },
    };

    render(<DeadlineCard agg={agg} />);

    // Each due bucket label appears exactly once — in the SegmentedBar legend,
    // no longer mirrored by a MetricLine grid.
    expect(screen.getAllByText("Overdue")).toHaveLength(1);
    expect(screen.getAllByText("This week")).toHaveLength(1);
    expect(screen.getAllByText("Upcoming")).toHaveLength(1);
    // The undated count is carried by the subtitle, now prefixed with the
    // card's population so it does not read as the in-scope total (REEF-185).
    expect(screen.queryByText("No due")).not.toBeInTheDocument();
    expect(screen.getByText("Open work · 5 undated")).toBeInTheDocument();
  });
});
