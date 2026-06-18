import type {
  IssueMetadata,
  Milestone,
  PlanningCatalog,
  Release,
} from "@reef/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REPORT_FILTERS, type ReportFilters } from "../lib/aggregate";
import { HealthRollup } from "./HealthRollup";

afterEach(cleanup);

function makeIssue(overrides: Partial<IssueMetadata>): IssueMetadata {
  return {
    id: "REEF-001",
    title: "Sample",
    status: "todo",
    created_at: "2026-06-05T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-06-15T00:00:00.000Z",
    updated_by: "alice",
    ...overrides,
  };
}

function milestone(
  id: string,
  status: Milestone["status"] = "open",
): Milestone {
  return { id, name: id, status, target_date: null, description: "" };
}

function release(id: string, status: Release["status"] = "planned"): Release {
  return {
    id,
    name: id,
    status,
    target_date: null,
    released_at: null,
    notes: "",
  };
}

const catalog: PlanningCatalog = {
  sprints: [],
  milestones: [milestone("M1"), milestone("M2"), milestone("M_DONE", "closed")],
  releases: [release("R1")],
};

const issues = [
  makeIssue({
    id: "A",
    milestone_id: "M1",
    status: "todo",
    due_date: "2026-01-01T00:00:00.000Z",
  }),
  makeIssue({ id: "B", milestone_id: "M2", status: "done" }),
  makeIssue({ id: "C", milestone_id: "M_DONE", status: "done" }),
  makeIssue({ id: "D", release_id: "R1", status: "todo" }),
];

function renderRollup(overrides?: {
  filters?: ReportFilters;
  onDrill?: (dimension: string, id: string) => void;
}) {
  const onDrill = overrides?.onDrill ?? vi.fn();
  render(
    <HealthRollup
      issues={issues}
      catalog={catalog}
      filters={overrides?.filters ?? DEFAULT_REPORT_FILTERS}
      onDrill={onDrill}
    />,
  );
  return { onDrill };
}

describe("HealthRollup", () => {
  it("renders one row per open milestone in the default dimension", () => {
    renderRollup();
    expect(screen.getByTestId("health-rollup")).toBeTruthy();
    expect(screen.getByTestId("health-rollup-row-M1")).toBeTruthy();
    expect(screen.getByTestId("health-rollup-row-M2")).toBeTruthy();
    // A closed (shipped) milestone is hidden until "show shipped" is toggled.
    expect(screen.queryByTestId("health-rollup-row-M_DONE")).toBeNull();
  });

  it("switches dimension via the segmented toggle", () => {
    renderRollup();
    // Milestones active by default → release row absent.
    expect(screen.queryByTestId("health-rollup-row-R1")).toBeNull();
    fireEvent.click(screen.getByTestId("health-rollup-dimension-release"));
    expect(screen.getByTestId("health-rollup-row-R1")).toBeTruthy();
    expect(screen.queryByTestId("health-rollup-row-M1")).toBeNull();
  });

  it("calls onDrill with the dimension and id when a row is clicked", () => {
    const { onDrill } = renderRollup();
    fireEvent.click(screen.getByTestId("health-rollup-row-M1"));
    expect(onDrill).toHaveBeenCalledWith("milestone", "M1");
  });

  it("reveals shipped items when the toggle is pressed", () => {
    renderRollup();
    const toggle = screen.getByTestId("health-rollup-show-shipped");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("health-rollup-row-M_DONE")).toBeTruthy();
  });

  it("marks the drilled row as pressed", () => {
    renderRollup({
      filters: { ...DEFAULT_REPORT_FILTERS, milestone_id: "M1" },
    });
    expect(
      screen.getByTestId("health-rollup-row-M1").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByTestId("health-rollup-row-M2").getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("offers a parent dimension and rolls up by the parent issue title", () => {
    const parentIssues = [
      makeIssue({ id: "E1", title: "Reports epic", status: "in_progress" }),
      makeIssue({ id: "c1", parent_id: "E1", status: "done" }),
      makeIssue({ id: "c2", parent_id: "E1", status: "todo" }),
    ];
    const onDrill = vi.fn();
    render(
      <HealthRollup
        issues={parentIssues}
        catalog={{ sprints: [], milestones: [milestone("M1")], releases: [] }}
        filters={DEFAULT_REPORT_FILTERS}
        onDrill={onDrill}
      />,
    );
    // Parent is available because issues reference a parent; switch to it.
    fireEvent.click(screen.getByTestId("health-rollup-dimension-parent"));
    const row = screen.getByTestId("health-rollup-row-E1");
    expect(row.textContent).toContain("Reports epic"); // title, not the id
    fireEvent.click(row);
    expect(onDrill).toHaveBeenCalledWith("parent", "E1");
  });

  it("hides the parent dimension when no issue has a parent", () => {
    // The default fixture issues carry no parent_id.
    renderRollup();
    expect(screen.queryByTestId("health-rollup-dimension-parent")).toBeNull();
  });

  it("counts off-track items separately from at-risk in the header", () => {
    // A milestone past its target with open work is off track; the header should
    // not fold it into an "at risk" count (REEF-191 follow-up).
    render(
      <HealthRollup
        issues={[
          makeIssue({ id: "L", milestone_id: "M_LATE", status: "todo" }),
        ]}
        catalog={{
          sprints: [],
          milestones: [
            {
              id: "M_LATE",
              name: "M_LATE",
              status: "open",
              target_date: "2020-01-01T00:00:00.000Z",
              description: "",
            },
          ],
          releases: [],
        }}
        filters={DEFAULT_REPORT_FILTERS}
        onDrill={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 off track/)).toBeTruthy();
    expect(screen.queryByText(/at risk/)).toBeNull();
  });
});
