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

  it("lays the row out as a grid with blocker as trailing metadata", () => {
    // The grid (not a flex row) keeps the title from collapsing and the type /
    // priority / blocker columns aligned. The blocker slot is trailing metadata
    // so it does not split the id/title identity flow (REEF-397).
    const { container } = render(
      <IssueOptionRow issue={{ ...ISSUE, priority: null }} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain(
      "grid-cols-[auto_minmax(5rem,max-content)_minmax(0,1fr)_auto_0.75rem_minmax(1.25rem,auto)]",
    );
    const identity = root.querySelector('[data-issue-option-slot="identity"]');
    expect(identity?.className).toContain("min-w-0");
    const issueId = screen.getByText("REEF-042");
    expect(issueId.className).toContain("block");
    expect(issueId.className).toContain("truncate");
    expect(issueId.parentElement?.className).toContain("shrink-0");
    const blocker = root.querySelector('[data-issue-option-slot="blocker"]');
    expect(blocker).not.toBeNull();
    expect(blocker?.className).toContain("min-w-5");
    expect(blocker?.className).not.toContain("overflow-hidden");
    expect(identity).not.toContainElement(blocker as HTMLElement);
    // No priority dot, but its column is still reserved so dots align row-to-row.
    expect(screen.queryByLabelText(/Priority:/)).toBeNull();
  });

  it("keeps the blocked marker outside the identity and title tracks", () => {
    const { rerender } = render(
      <IssueOptionRow issue={ISSUE} blockerCount={0} />,
    );

    const title = screen.getByText("Card-level dropdown rows");
    const titleSlot = title.closest('[data-issue-option-slot="title"]');
    const blockerSlot = title
      .closest("[data-issue-option-row]")
      ?.querySelector('[data-issue-option-slot="blocker"]');
    const identitySlot = title
      .closest("[data-issue-option-row]")
      ?.querySelector('[data-issue-option-slot="identity"]');
    expect(titleSlot).not.toBeNull();
    expect(blockerSlot).not.toBeNull();
    expect(blockerSlot).toBeEmptyDOMElement();
    expect(identitySlot).not.toContainElement(blockerSlot as HTMLElement);

    rerender(<IssueOptionRow issue={ISSUE} blockerCount={2} />);

    const marker = screen.getByLabelText("Blocked by 2 issues");
    expect(marker.closest('[data-issue-option-slot="blocker"]')).toBe(
      blockerSlot,
    );
    expect(identitySlot).not.toContainElement(marker);
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
      "grid-cols-[auto_minmax(5rem,max-content)_minmax(0,1fr)_auto_0.75rem_minmax(1.25rem,auto)]",
    );
    const marker = screen.getByLabelText("Blocked by 12 issues");
    expect(marker).toHaveTextContent("9+");
    expect(marker.closest('[data-issue-option-slot="blocker"]')).not.toBeNull();
    expect(
      marker.closest('[data-issue-option-slot="blocker"]')?.className,
    ).toContain("min-w-5");
    expect(marker.className).toContain("text-destructive/80");
    expect(marker.className).not.toContain("max-w-full");

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
