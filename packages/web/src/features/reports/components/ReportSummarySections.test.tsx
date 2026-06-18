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
    const byStatus: StatusCount[] = [
      { status: "backlog", count: 0 },
      { status: "todo", count: 3 },
      { status: "in_progress", count: 1 },
      { status: "in_review", count: 2 },
      { status: "done", count: 4 },
      { status: "closed", count: 0 },
    ];
    const agg: ReportAggregates = {
      ...base,
      total: 10,
      kpis: { ...base.kpis, inProgress: 1, done: 4 },
      byStatus,
    };

    render(<StatusFunnel rows={byStatus} agg={agg} />);

    // Completion is the single home for the done ratio.
    expect(screen.getByText("Completion")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    // WIP is a distinct ratio, not echoed by the funnel, so it stays.
    expect(screen.getByText("WIP")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
    // The in-review count lives in the funnel legend; the "Review queue"
    // MetricLine that repeated it is gone.
    expect(screen.queryByText("Review queue")).not.toBeInTheDocument();
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
