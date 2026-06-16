import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueDetailHeader } from "./IssueDetailHeader";

afterEach(cleanup);

type HeaderProps = Parameters<typeof IssueDetailHeader>[0];

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
});
