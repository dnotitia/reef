import type { IssueListItem } from "@reef/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueDetailHeader } from "./IssueDetailHeader";

// next/link needs the app-router context for prefetch; in unit tests we just
// care that it renders a navigable anchor, so stub it to a plain <a>.
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
    "data-testid": dataTestId,
    "data-issue-id": dataIssueId,
  }: {
    children: ReactNode;
    href: string;
    className?: string;
    "data-testid"?: string;
    "data-issue-id"?: string;
  }) => (
    <a
      href={href}
      className={className}
      data-testid={dataTestId}
      data-issue-id={dataIssueId}
    >
      {children}
    </a>
  ),
}));

afterEach(cleanup);

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
  const onClose = vi.fn();
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
    onClose,
    parentId: null,
    allIssues: [],
    ...overrides,
  };
  render(<IssueDetailHeader {...props} />);
  return { onClose };
}

describe("IssueDetailHeader", () => {
  it("renders an in-flow close button that dismisses via onClose (REEF-111)", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();

    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toHaveAttribute("data-testid", "issue-close");

    await user.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the issue actions menu as a sibling of the close button", () => {
    setup();
    // Both affordances coexist in the header's right-hand action group rather
    // than the actions menu competing with an overlay X.
    expect(
      screen.getByRole("button", { name: "Issue actions" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  describe("parent breadcrumb (REEF-266)", () => {
    const PARENT_ID = "REEF-182";
    const parent = makeIssue({
      id: PARENT_ID,
      title: "Reports & analytics epic",
    });

    it("links the breadcrumb to the parent detail with id and title", () => {
      setup({ parentId: PARENT_ID, allIssues: [parent] });

      const nav = screen.getByRole("navigation", { name: "Issue hierarchy" });
      expect(nav).toBeInTheDocument();

      const link = screen.getByTestId("issue-parent-breadcrumb");
      expect(link).toHaveAttribute("href", "/issues/REEF-182");
      expect(link).toHaveAttribute("data-issue-id", "REEF-182");
      expect(link).toHaveTextContent("REEF-182");
      expect(link).toHaveTextContent("Reports & analytics epic");
    });

    it("hides the glyph from assistive tech", () => {
      setup({ parentId: PARENT_ID, allIssues: [parent] });
      const glyph = screen
        .getByTestId("issue-parent-breadcrumb")
        .querySelector("svg");
      expect(glyph).toHaveAttribute("aria-hidden", "true");
    });

    it("renders nothing above the header for a top-level issue", () => {
      setup({ parentId: null });
      expect(
        screen.queryByRole("navigation", { name: "Issue hierarchy" }),
      ).toBeNull();
      expect(screen.queryByTestId("issue-parent-breadcrumb")).toBeNull();
    });

    it("degrades to id-only when the parent is absent from the loaded list", () => {
      setup({ parentId: PARENT_ID, allIssues: [] });

      const link = screen.getByTestId("issue-parent-breadcrumb");
      expect(link).toHaveAttribute("href", "/issues/REEF-182");
      // No resolved title to show — the link stays navigable with the id alone.
      expect(link.textContent).toBe("REEF-182");
    });
  });
});
