import { type IssueListItem, type IssueType, IssueTypeEnum } from "@reef/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IssueOptionRow } from "./IssueOptionRow";
import { ISSUE_TYPE_COLORS } from "./fieldKit";

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

const TYPE_LABELS = {
  epic: "Epic",
  story: "Story",
  task: "Task",
  bug: "Bug",
  spike: "Spike",
  chore: "Chore",
} satisfies Record<IssueType, string>;

const TYPE_ICON_CLASSES = {
  epic: "lucide-layers",
  story: "lucide-bookmark",
  task: "lucide-square-check",
  bug: "lucide-bug",
  spike: "lucide-flask-conical",
  chore: "lucide-wrench",
} satisfies Record<IssueType, string>;

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

  it("lays the row out as a fixed-track grid with blocker inside the id track", () => {
    // The grid (not a flex row) keeps the title from collapsing and the type /
    // priority columns aligned. The blocker slot uses the reserved room inside
    // the fixed id track instead of adding another outer column (REEF-390).
    const { container } = render(
      <IssueOptionRow issue={{ ...ISSUE, priority: null }} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain(
      "grid-cols-[auto_5rem_minmax(0,1fr)_auto_0.75rem]",
    );
    const identity = root.querySelector('[data-issue-option-slot="identity"]');
    expect(identity?.className).toContain("grid-cols-[minmax(0,1fr)_1.25rem]");
    expect(screen.getByText("REEF-042").className).toContain("block");
    expect(screen.getByText("REEF-042").className).toContain("truncate");
    expect(
      identity?.querySelector('[data-issue-option-slot="blocker"]'),
    ).not.toBeNull();
    // No priority dot, but its column is still reserved so dots align row-to-row.
    expect(screen.queryByLabelText(/Priority:/)).toBeNull();
  });

  it("keeps the blocked marker in its own column outside the title track", () => {
    const { rerender } = render(
      <IssueOptionRow issue={ISSUE} blockerCount={0} />,
    );

    const title = screen.getByText("Card-level dropdown rows");
    const titleSlot = title.closest('[data-issue-option-slot="title"]');
    const blockerSlot = title
      .closest("[data-issue-option-row]")
      ?.querySelector('[data-issue-option-slot="identity"]')
      ?.querySelector('[data-issue-option-slot="blocker"]');
    expect(titleSlot).not.toBeNull();
    expect(blockerSlot).not.toBeNull();
    expect(blockerSlot).toBeEmptyDOMElement();

    rerender(<IssueOptionRow issue={ISSUE} blockerCount={2} />);

    const marker = screen.getByLabelText("Blocked by 2 issues");
    expect(marker.closest('[data-issue-option-slot="blocker"]')).toBe(
      blockerSlot,
    );
    expect(titleSlot).not.toContainElement(marker);
    expect(
      screen
        .getByText("Card-level dropdown rows")
        .closest('[data-issue-option-slot="title"]'),
    ).toBe(titleSlot);
  });

  it("keeps long narrow rows truncating in the title track only", () => {
    const { container } = render(
      <IssueOptionRow
        issue={{
          ...ISSUE,
          title:
            "A very long relation row title that should truncate before meta columns move",
        }}
        blockerCount={12}
        className="w-40"
      />,
    );

    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain(
      "grid-cols-[auto_5rem_minmax(0,1fr)_auto_0.75rem]",
    );
    const marker = screen.getByLabelText("Blocked by 12 issues");
    expect(marker).toHaveTextContent("9+");
    expect(marker.closest('[data-issue-option-slot="blocker"]')).not.toBeNull();

    const title = screen.getByText(/A very long relation row title/);
    expect(title).toHaveClass("min-w-0");
    expect(title).toHaveClass("truncate");
    expect(
      title.closest('[data-issue-option-slot="title"]'),
    ).not.toContainElement(marker);
    expect(screen.getByText("Story")).toBeInTheDocument();
    expect(screen.getByLabelText("Priority: High")).toBeInTheDocument();
  });

  it.each(IssueTypeEnum.options)(
    "renders %s as a chrome-less glyph-only type marker (REEF-376)",
    (issueType) => {
      // Every type drops the pill chrome and keeps only the existing TypePill
      // shape + color glyph. The label is sr-only so assistive tech still gets
      // the type name while the decorative glyph stays aria-hidden.
      render(<IssueOptionRow issue={{ ...ISSUE, issue_type: issueType }} />);
      const typeLabel = screen.getByText(TYPE_LABELS[issueType]);
      const pill = typeLabel.parentElement as HTMLElement;
      const pillClasses = pill.className.split(/\s+/);
      expect(pill.className).not.toContain("bg-secondary");
      expect(pill.className).not.toContain("px-2");
      expect(pill.className).not.toContain("py-0.5");
      expect(pillClasses).toContain("border-0");
      expect(pillClasses).toContain("bg-transparent");
      expect(pillClasses).toContain("px-0");
      expect(pillClasses).toContain("py-0");

      expect(typeLabel.className).toContain("sr-only");
      expect(typeLabel.className).not.toContain("@max-");

      const glyph = pill.querySelector("svg") as SVGElement;
      expect(glyph).toHaveAttribute("aria-hidden", "true");
      expect(glyph.getAttribute("class") ?? "").toContain(
        TYPE_ICON_CLASSES[issueType],
      );
      expect(glyph.getAttribute("class") ?? "").toContain(
        ISSUE_TYPE_COLORS[issueType],
      );
    },
  );

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
