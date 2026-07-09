import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import type { IssueListItem } from "@reef/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueChildren } from "./IssueChildren";

const { mockReplace } = vi.hoisted(() => ({ mockReplace: vi.fn() }));

// next/link needs the app-router context for prefetch; in unit tests we just
// care that it renders a navigable anchor, so stub it to a plain <a> that
// forwards every prop (href, className, data-*, the drill onClick — REEF-270).
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

// The sub-issue drill reads the live query + router; an empty `useSearchParams`
// keeps the href bare so the existing assertions hold (REEF-270).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ vault: "reef-test" }),
}));

// useIssueDrill resolves the active vault (REEF-315) via useActiveVault, which
// calls useQuery; this component renders without a QueryClient, so resolve it to
// a fixed vault that scopes the drill hrefs.
vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: "reef-test",
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  mockReplace.mockClear();
  useIssueNavStack.setState({ trail: [], currentId: null });
});

const base = {
  created_by: "alice",
  updated_by: "alice",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
} satisfies Partial<IssueListItem>;

function makeIssue(overrides: Partial<IssueListItem>): IssueListItem {
  return {
    ...base,
    id: "REEF-000",
    title: "Untitled",
    status: "todo",
    ...overrides,
  };
}

const PARENT = "REEF-100";

const childOpen = makeIssue({
  id: "REEF-101",
  title: "Open child",
  parent_id: PARENT,
  status: "todo",
});
const childInProgress = makeIssue({
  id: "REEF-103",
  title: "Active child",
  parent_id: PARENT,
  status: "in_progress",
});
const childDone = makeIssue({
  id: "REEF-102",
  title: "Done child",
  parent_id: PARENT,
  status: "done",
});
const other = makeIssue({
  id: "REEF-200",
  title: "Someone else's child",
  parent_id: "REEF-999",
});

const ALL = [other, childDone, childInProgress, childOpen];

describe("IssueChildren", () => {
  it("lists only issues whose parent_id is the current issue", () => {
    render(<IssueChildren issueId={PARENT} allIssues={ALL} />);
    expect(screen.getByText("REEF-101")).toBeTruthy();
    expect(screen.getByText("REEF-102")).toBeTruthy();
    expect(screen.getByText("REEF-103")).toBeTruthy();
    expect(screen.queryByText("REEF-200")).toBeNull();
  });

  it("renders an empty state and keeps the add action with the Sub-issues section", () => {
    render(
      <IssueChildren
        issueId="REEF-555"
        allIssues={ALL}
        action={<button type="button">Add sub-issue</button>}
      />,
    );
    expect(screen.getByTestId("issue-children")).toBeInTheDocument();
    expect(screen.getByTestId("issue-children-empty")).toHaveTextContent(
      "No sub-issues yet.",
    );
    expect(
      screen.getByRole("button", { name: "Add sub-issue" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("summarizes resolved vs total and exposes a progressbar", () => {
    render(<IssueChildren issueId={PARENT} allIssues={ALL} />);
    expect(screen.getByText("1 of 3 done")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe("3");
  });

  it("orders remaining work first (lifecycle order) and resolved last", () => {
    render(<IssueChildren issueId={PARENT} allIssues={ALL} />);
    const ids = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("data-issue-id"));
    expect(ids).toEqual(["REEF-101", "REEF-103", "REEF-102"]);
  });

  it("dims resolved children", () => {
    render(<IssueChildren issueId={PARENT} allIssues={ALL} />);
    const doneLink = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("data-issue-id") === "REEF-102");
    expect(doneLink?.className).toContain("opacity-60");
  });

  it("links each child to its detail route", () => {
    render(<IssueChildren issueId={PARENT} allIssues={ALL} />);
    const openLink = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("data-issue-id") === "REEF-101");
    expect(openLink?.getAttribute("href")).toBe(
      "/workspace/reef-test/issues/REEF-101",
    );
  });

  it("drills into a child in place: records the hop and replaces (REEF-270)", async () => {
    const user = userEvent.setup();
    render(<IssueChildren issueId={PARENT} allIssues={ALL} />);
    const openLink = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("data-issue-id") === "REEF-101");

    await user.click(openLink as HTMLElement);

    // The parent we left is pushed onto the in-memory trail and the target
    // becomes the expected current issue, so a later Back returns here.
    expect(useIssueNavStack.getState().trail).toEqual([PARENT]);
    expect(useIssueNavStack.getState().currentId).toBe("REEF-101");
    // The hop swaps content with replace (flat history), not a pushed entry.
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(
      "/workspace/reef-test/issues/REEF-101",
    );
  });

  it("lets a modifier click open a fresh tab instead of drilling (REEF-270)", () => {
    render(<IssueChildren issueId={PARENT} allIssues={ALL} />);
    const openLink = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("data-issue-id") === "REEF-101");

    // Cmd/Ctrl-click falls through to the anchor's native new-tab behavior, so
    // the in-panel drill should not fire and the trail stays empty.
    fireEvent.click(openLink as HTMLElement, { button: 0, metaKey: true });

    expect(mockReplace).not.toHaveBeenCalled();
    expect(useIssueNavStack.getState().trail).toEqual([]);
  });

  it("shows a blocked badge for a child with an unresolved dependency", () => {
    const blocker = makeIssue({ id: "REEF-900", status: "todo" });
    const blockedChild = makeIssue({
      id: "REEF-104",
      title: "Blocked child",
      parent_id: PARENT,
      status: "todo",
      depends_on: ["REEF-900"],
    });
    render(
      <IssueChildren
        issueId={PARENT}
        allIssues={[blocker, blockedChild]}
        relationGraph={[blocker, blockedChild]}
      />,
    );
    const badge = screen.getByLabelText("Blocked by 1 issue");
    const title = screen.getByText("Blocked child");
    const row = title.closest("[data-issue-option-row]");
    expect(badge.closest('[data-issue-option-slot="blocker"]')).not.toBeNull();
    expect(badge.closest('[data-issue-option-slot="identity"]')).toBe(
      row?.querySelector('[data-issue-option-slot="identity"]'),
    );
    expect(
      title.closest('[data-issue-option-slot="title"]'),
    ).not.toContainElement(badge);
    expect(row?.className).toContain(
      "grid-cols-[auto_5rem_minmax(0,1fr)_auto_0.75rem]",
    );
  });
});
