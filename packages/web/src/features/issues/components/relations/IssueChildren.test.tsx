import type { IssueListItem } from "@reef/core";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueChildren } from "./IssueChildren";

// next/link needs the app-router context for prefetch; in unit tests we just
// care that it renders a navigable anchor, so stub it to a plain <a>.
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
    "data-issue-id": dataIssueId,
  }: {
    children: ReactNode;
    href: string;
    className?: string;
    "data-issue-id"?: string;
  }) => (
    <a href={href} className={className} data-issue-id={dataIssueId}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

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

  it("renders nothing when the issue has no children", () => {
    const { container } = render(
      <IssueChildren issueId="REEF-555" allIssues={ALL} />,
    );
    expect(screen.queryByTestId("issue-children")).toBeNull();
    expect(container.firstChild).toBeNull();
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
    expect(openLink?.getAttribute("href")).toBe("/issues/REEF-101");
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
    expect(screen.getByText(/Blocked \(1\)/)).toBeTruthy();
  });
});
