import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import type { IssueListItem } from "@reef/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueDetailHeader } from "./IssueDetailHeader";

const { mockReplace } = vi.hoisted(() => ({ mockReplace: vi.fn() }));

// next/link needs the app-router context for prefetch; in unit tests we just
// care that it renders a navigable anchor, so stub it to a plain <a> that
// forwards every prop (href, className, data-*, title, aria-label, onClick).
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The parent breadcrumb now drills in place (REEF-270); an empty
// `useSearchParams` keeps the href bare so the REEF-279 assertions hold.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  mockReplace.mockClear();
  useIssueNavStack.setState({ trail: [], currentId: null });
});

type HeaderProps = Parameters<typeof IssueDetailHeader>[0];

const issueBase = {
  created_by: "alice",
  updated_by: "alice",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
} satisfies Partial<IssueListItem>;

function makeIssue(overrides: Partial<IssueListItem>): IssueListItem {
  return {
    ...issueBase,
    id: "REEF-000",
    title: "Untitled",
    status: "todo",
    ...overrides,
  };
}

function setup(overrides: Partial<HeaderProps> = {}) {
  const props: HeaderProps = {
    issueId: "REEF-111",
    issueType: "bug",
    status: "todo",
    isArchived: false,
    updatedAt: null,
    saveStatus: "idle",
    onRetryLastCommit: vi.fn(),
    isArchivePending: false,
    isDeletePending: false,
    onArchiveToggle: vi.fn(),
    onDeleteRequested: vi.fn(),
    parentId: null,
    allIssues: [],
    ...overrides,
  };
  render(<IssueDetailHeader {...props} />);
}

describe("IssueDetailHeader", () => {
  it("renders the issue actions menu (close lives in the sheet chrome row, REEF-284)", () => {
    setup();
    // The header keeps the per-issue actions menu; the close affordance moved up
    // to the sheet's top chrome row, so it is no longer rendered here.
    expect(
      screen.getByRole("button", { name: "Issue actions" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
  });

  describe("parent breadcrumb (REEF-266)", () => {
    const PARENT_ID = "REEF-182";
    const parent = makeIssue({
      id: PARENT_ID,
      title: "Reports & analytics epic",
    });

    it("renders the resolved crumb as a status glyph + title, with the id only in href/data (REEF-279)", () => {
      setup({ parentId: PARENT_ID, allIssues: [parent] });

      const nav = screen.getByRole("navigation", { name: "Issue hierarchy" });
      expect(nav).toBeInTheDocument();

      const link = screen.getByTestId("issue-parent-breadcrumb");
      // Routing + test hooks still carry the parent id…
      expect(link).toHaveAttribute("href", "/issues/REEF-182");
      expect(link).toHaveAttribute("data-issue-id", "REEF-182");
      // …but the raw mono id no longer shows in the visible crumb text — the
      // parent title alone names it (REEF-279 AC1).
      expect(link).toHaveTextContent("Reports & analytics epic");
      expect(link.textContent).not.toContain("REEF-182");
      // A leading status glyph replaces the id (REEF-279 AC2). It is decorative,
      // so it adds an svg but no extra accessible text (the aria-label is the
      // single accessible name, asserted below).
      expect(link.querySelector("svg")).not.toBeNull();
    });

    it("drills to the parent in place, recording the hop (REEF-270)", async () => {
      const user = userEvent.setup();
      // Current issue is REEF-111 (the header's issueId); clicking the parent
      // crumb should push REEF-111 onto the trail and replace to the parent.
      setup({ parentId: PARENT_ID, allIssues: [parent] });

      await user.click(screen.getByTestId("issue-parent-breadcrumb"));

      expect(useIssueNavStack.getState().trail).toEqual(["REEF-111"]);
      expect(useIssueNavStack.getState().currentId).toBe(PARENT_ID);
      expect(mockReplace).toHaveBeenCalledWith("/issues/REEF-182");
    });

    it("names the parent relationship for hover and assistive tech", () => {
      // The horizontal breadcrumb trail + the › separator carry the at-a-glance
      // "parent" reading; the explicit wording lives in title/aria-label for
      // hover + assistive tech (REEF-266 follow-up).
      setup({ parentId: PARENT_ID, allIssues: [parent] });
      const link = screen.getByTestId("issue-parent-breadcrumb");
      expect(link).toHaveAttribute("title", "Go to parent issue");
      expect(link).toHaveAccessibleName(
        "Parent issue REEF-182: Reports & analytics epic",
      );
    });

    it("falls back to an id-only accessible name when the title is unresolved", () => {
      setup({ parentId: PARENT_ID, allIssues: [] });
      expect(
        screen.getByTestId("issue-parent-breadcrumb"),
      ).toHaveAccessibleName("Parent issue REEF-182");
    });

    it("orders the parent crumb before the current issue id (trail order)", () => {
      // Horizontal breadcrumb: parent first, current issue last ("you are here").
      setup({ parentId: PARENT_ID, allIssues: [parent] });
      const crumb = screen.getByTestId("issue-parent-breadcrumb");
      const currentId = screen.getByText("REEF-111");
      expect(
        crumb.compareDocumentPosition(currentId) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("renders nothing above the header for a top-level issue", () => {
      setup({ parentId: null });
      expect(
        screen.queryByRole("navigation", { name: "Issue hierarchy" }),
      ).toBeNull();
      expect(screen.queryByTestId("issue-parent-breadcrumb")).toBeNull();
    });

    it("degrades to id-only without an icon when the parent is absent from the loaded list", () => {
      setup({ parentId: PARENT_ID, allIssues: [] });

      const link = screen.getByTestId("issue-parent-breadcrumb");
      expect(link).toHaveAttribute("href", "/issues/REEF-182");
      // No resolved parent → no status to show, so no glyph renders and the link
      // degrades to the id alone, staying navigable and never empty (REEF-279
      // AC4).
      expect(link.querySelector("svg")).toBeNull();
      expect(link.textContent).toBe("REEF-182");
    });
  });
});
