import type { IssueMetadata } from "@reef/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_REPORT_FILTERS } from "../lib/aggregate";
import { PivotCard } from "./PivotCard";

afterEach(cleanup);

function makeIssue(overrides: Partial<IssueMetadata>): IssueMetadata {
  return {
    id: "REEF-001",
    title: "Sample",
    status: "todo",
    created_at: "2026-04-13T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-04-13T00:00:00.000Z",
    updated_by: "alice",
    ...overrides,
  };
}

// alice: todo + done; bob: todo only — so the (bob, Done) intersection is an
// empty cell while its Done column still exists (AC3).
const issues = [
  makeIssue({
    id: "R1",
    assigned_to: "alice",
    status: "todo",
    issue_type: "story",
  }),
  makeIssue({
    id: "R2",
    assigned_to: "alice",
    status: "done",
    issue_type: "story",
  }),
  makeIssue({
    id: "R3",
    assigned_to: "bob",
    status: "todo",
    issue_type: "bug",
  }),
];

function renderCard() {
  render(<PivotCard issues={issues} filters={DEFAULT_REPORT_FILTERS} />);
}

describe("PivotCard (REEF-189)", () => {
  it("renders a count crosstab with the default Assignee × Status axes (AC1)", () => {
    renderCard();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByTestId("pivot-row-field-trigger").textContent).toContain(
      "Assignee",
    );
    expect(screen.getByTestId("pivot-col-field-trigger").textContent).toContain(
      "Status",
    );
    // Row/column headers and an intersecting count.
    expect(
      screen.getByRole("rowheader", { name: "alice" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Todo" }),
    ).toBeInTheDocument();
    expect(screen.getByTitle("alice × Todo: 1").textContent).toBe("1");
    expect(screen.getByTitle("alice × Done: 1").textContent).toBe("1");
  });

  it("shows empty cells and consistent row/column totals (AC3)", () => {
    renderCard();
    // bob has no Done issue: the cell exists but is blank, not a zero glyph.
    expect(screen.getByTitle("bob × Done: 0").textContent).toBe("");
    // A Total column header and a Total row header.
    expect(screen.getAllByText("Total").length).toBeGreaterThanOrEqual(2);
    // Grand total = 3 issues, in the corner cell.
    expect(screen.getByRole("table").textContent).toContain("3");
  });

  it("row picker offers every categorical field except the column's (AC2)", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByTestId("pivot-row-field-trigger"));
    for (const key of ["type", "priority", "severity", "assignee", "label"]) {
      expect(
        screen.getByTestId(`pivot-row-field-option-${key}`),
      ).toBeInTheDocument();
    }
    // Status is the current column, so it is not also offered as a row.
    expect(
      screen.queryByTestId("pivot-row-field-option-status"),
    ).not.toBeInTheDocument();
  });

  it("column picker offers the remaining field (Status) so all six are reachable (AC2)", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByTestId("pivot-col-field-trigger"));
    expect(
      screen.getByTestId("pivot-col-field-option-status"),
    ).toBeInTheDocument();
    // Assignee is the current row, so it is not also offered as a column.
    expect(
      screen.queryByTestId("pivot-col-field-option-assignee"),
    ).not.toBeInTheDocument();
  });

  it("re-pivots when the row field changes (AC1)", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByTestId("pivot-row-field-trigger"));
    await user.click(screen.getByTestId("pivot-row-field-option-type"));

    expect(screen.getByTestId("pivot-row-field-trigger").textContent).toContain(
      "Type",
    );
    expect(
      screen.getByRole("rowheader", { name: "Story" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: "alice" })).toBeNull();
    expect(screen.getByTitle("Story × Todo: 1").textContent).toBe("1");
  });
});
