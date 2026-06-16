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

  it("renders the blocked badge only when blockerCount > 0", () => {
    const { rerender } = render(
      <IssueOptionRow issue={ISSUE} blockerCount={0} />,
    );
    expect(screen.queryByText(/Blocked/)).toBeNull();

    rerender(<IssueOptionRow issue={ISSUE} blockerCount={2} />);
    expect(screen.getByText("Blocked (2)")).toBeInTheDocument();
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
