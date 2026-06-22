import { STATUS_LABELS } from "@/components/fields/fieldKit";
import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import type { IssueListItem } from "@reef/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueChromeIdentity } from "./IssueChromeIdentity";

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

// The parent breadcrumb drills in place (REEF-270); an empty `useSearchParams`
// keeps the href bare so the REEF-279 assertions hold.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  mockReplace.mockClear();
  useIssueNavStack.setState({ trail: [], currentId: null });
});

type IdentityProps = Parameters<typeof IssueChromeIdentity>[0];

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

function setup(overrides: Partial<IdentityProps> = {}) {
  const props: IdentityProps = {
    issueId: "REEF-111",
    status: "todo",
    issueType: "bug",
    isArchived: false,
    parentId: null,
    allIssues: [],
    // Default: the list has finished loading. The `allIssues: []` cases below
    // therefore mean "loaded, parent genuinely absent" (REEF-279 AC4), not
    // "still loading" — the loading path opts in with `allIssuesPending: true`.
    allIssuesPending: false,
    ...overrides,
  };
  render(<IssueChromeIdentity {...props} />);
}

describe("IssueChromeIdentity", () => {
  describe("route-param id persistence (REEF-286)", () => {
    it("shows the route-param id with no status glyph or type pill before the issue loads", () => {
      // The bar opens on a drill into an uncached issue: the route param is
      // known, so the id is shown alone (no glyph/pill flash) until useIssue
      // lands.
      setup({ status: undefined, issueType: undefined });
      expect(screen.getByText("REEF-111")).toBeInTheDocument();
      // No current-status glyph (StatusIcon is the sole role=img here) and no
      // archived badge until the data arrives.
      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.queryByTestId("issue-archived-badge")).toBeNull();
    });

    it("fills the status glyph and type pill once the issue loads", () => {
      setup({ status: "in_progress", issueType: "story" });
      expect(screen.getByText("REEF-111")).toBeInTheDocument();
      // The current status glyph is a labelled (non-decorative) icon.
      expect(
        screen.getByRole("img", { name: STATUS_LABELS.in_progress }),
      ).toBeInTheDocument();
      // The type pill renders its label.
      expect(screen.getByText("Story")).toBeInTheDocument();
    });

    it("shows the archived badge when the issue is archived", () => {
      setup({ isArchived: true });
      expect(screen.getByTestId("issue-archived-badge")).toBeInTheDocument();
    });
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
      expect(link).toHaveAttribute("href", "/issues/REEF-182");
      expect(link).toHaveAttribute("data-issue-id", "REEF-182");
      expect(link).toHaveTextContent("Reports & analytics epic");
      expect(link.textContent).not.toContain("REEF-182");
      // A leading decorative status glyph replaces the id (REEF-279 AC2).
      expect(link.querySelector("svg")).not.toBeNull();
    });

    it("drills to the parent in place, recording the hop (REEF-270)", async () => {
      const user = userEvent.setup();
      // Current issue is REEF-111; clicking the parent crumb pushes REEF-111
      // onto the trail and replaces to the parent.
      setup({ parentId: PARENT_ID, allIssues: [parent] });

      await user.click(screen.getByTestId("issue-parent-breadcrumb"));

      expect(useIssueNavStack.getState().trail).toEqual(["REEF-111"]);
      expect(useIssueNavStack.getState().currentId).toBe(PARENT_ID);
      expect(mockReplace).toHaveBeenCalledWith("/issues/REEF-182");
    });

    it("names the parent relationship for hover and assistive tech", () => {
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
      setup({ parentId: PARENT_ID, allIssues: [parent] });
      const crumb = screen.getByTestId("issue-parent-breadcrumb");
      const currentId = screen.getByText("REEF-111");
      expect(
        crumb.compareDocumentPosition(currentId) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("renders no breadcrumb for a top-level issue", () => {
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
      // No resolved parent → no status glyph, so the link degrades to the id
      // alone, staying navigable and not empty (REEF-279 AC4).
      expect(link.querySelector("svg")).toBeNull();
      expect(link.textContent).toBe("REEF-182");
    });

    it("holds a neutral skeleton — never the raw id — while the list is still loading (REEF-283)", () => {
      setup({ parentId: PARENT_ID, allIssues: [], allIssuesPending: true });

      const link = screen.getByTestId("issue-parent-breadcrumb");
      expect(link).toHaveAttribute("href", "/issues/REEF-182");
      expect(link).toHaveAttribute("data-issue-id", "REEF-182");
      expect(
        screen.getByTestId("issue-parent-breadcrumb-loading"),
      ).toBeInTheDocument();
      expect(link.textContent).not.toContain("REEF-182");
      expect(link.querySelector("svg")).toBeNull();
      expect(link).toHaveAccessibleName("Parent issue REEF-182");
    });

    it("shows the resolved title even if the list is flagged pending (resolved wins)", () => {
      setup({
        parentId: PARENT_ID,
        allIssues: [parent],
        allIssuesPending: true,
      });

      const link = screen.getByTestId("issue-parent-breadcrumb");
      expect(link).toHaveTextContent("Reports & analytics epic");
      expect(link.querySelector("svg")).not.toBeNull();
      expect(
        screen.queryByTestId("issue-parent-breadcrumb-loading"),
      ).toBeNull();
    });
  });
});
