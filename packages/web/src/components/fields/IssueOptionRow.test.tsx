import type { IssueListItem } from "@reef/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IssueOptionRow } from "./IssueOptionRow";

const ISSUE: IssueListItem = {
  id: "REEF-042",
  title: "Card-level dropdown rows",
  status: "in_progress",
  issue_type: "story",
  priority: "high",
  created_at: "2026-06-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-06-01T00:00:00.000Z",
  updated_by: "alice",
};

describe("IssueOptionRow", () => {
  it("renders id, title, status, type pill, and priority dot", () => {
    render(<IssueOptionRow issue={ISSUE} />);
    expect(screen.getByText("REEF-042")).toBeInTheDocument();
    expect(screen.getByText("Card-level dropdown rows")).toBeInTheDocument();
    expect(screen.getByText("Story")).toBeInTheDocument();
    expect(screen.getByLabelText("In Progress")).toBeInTheDocument();
    expect(screen.getByLabelText("Priority: High")).toBeInTheDocument();
  });

  it("omits the priority dot when priority is unset", () => {
    render(<IssueOptionRow issue={{ ...ISSUE, priority: null }} />);
    expect(screen.queryByLabelText(/Priority:/)).toBeNull();
  });

  it("renders the blocked marker only when blockerCount > 0", () => {
    const { rerender } = render(
      <IssueOptionRow issue={ISSUE} blockerCount={0} />,
    );
    expect(screen.queryByLabelText(/^Blocked by/)).toBeNull();

    rerender(<IssueOptionRow issue={ISSUE} blockerCount={2} />);
    // The compact marker encodes the count as glyph + number; the full sentence
    // is its accessible name (REEF-285).
    expect(screen.getByLabelText("Blocked by 2 issues")).toBeInTheDocument();
  });

  it("lays the row out as a fixed-track grid with a reserved priority column", () => {
    // The grid (not a flex row) keeps the title from collapsing and the type /
    // priority columns aligned across rows whether or not a row has a priority
    // or a blocked marker (REEF-285).
    const { container } = render(
      <IssueOptionRow issue={{ ...ISSUE, priority: null }} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain(
      "grid-cols-[auto_5rem_minmax(0,1fr)_auto_0.75rem]",
    );
    // No priority dot, but its column is still reserved so dots align row-to-row.
    expect(screen.queryByLabelText(/Priority:/)).toBeNull();
  });

  it("highlights the query inside id and title", () => {
    const { container } = render(<IssueOptionRow issue={ISSUE} query="card" />);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("Card");
  });

  it("shows the selected check when selected", () => {
    render(<IssueOptionRow issue={ISSUE} selected />);
    expect(screen.getByLabelText("Selected")).toBeInTheDocument();
  });

  it("marks the monospace id as non-translatable", () => {
    // The reef id is a code identifier, so its wrapper opts out of machine
    // translation (browser auto-translate would otherwise mangle "REEF-042").
    render(<IssueOptionRow issue={ISSUE} />);
    expect(
      screen.getByText("REEF-042").closest("[translate='no']"),
    ).not.toBeNull();
  });
});
