import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigationState } = vi.hoisted(() => ({
  navigationState: {
    pathname: "/workspace/reef-test/issues",
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: "reef-test",
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

import { IssuesSubNav } from "./IssuesSubNav";

describe("IssuesSubNav", () => {
  beforeEach(() => {
    navigationState.pathname = "/workspace/reef-test/issues";
  });

  it("renders the two addressable Issues routes in one shared nav", () => {
    render(<IssuesSubNav />);

    const nav = screen.getByRole("navigation", { name: "Issue sections" });
    expect(nav).toBeInTheDocument();
    const issueList = screen.getByTestId("issues-subnav-issue-list");
    expect(issueList).toHaveAttribute("href", "/workspace/reef-test/issues");
    expect(issueList).toHaveAccessibleName(/Issue list.*Current page/u);
    expect(screen.getByTestId("issues-subnav-change-review")).toHaveAttribute(
      "href",
      "/workspace/reef-test/issues/changes",
    );
  });

  it("marks the Issues route active only on the list surface", () => {
    render(<IssuesSubNav />);

    const issueList = screen.getByTestId("issues-subnav-issue-list");
    expect(issueList).toHaveAttribute("aria-current", "page");
    expect(issueList).toHaveAccessibleName(/Issue list.*Current page/u);
    expect(
      screen.getByTestId("issues-subnav-change-review"),
    ).not.toHaveAccessibleName(/Current page/u);
  });

  it("marks change review active and keeps issue details in the list section", () => {
    navigationState.pathname = "/workspace/reef-test/issues/changes";
    const { rerender } = render(<IssuesSubNav />);

    const changeReview = screen.getByTestId("issues-subnav-change-review");
    expect(changeReview).toHaveAttribute("aria-current", "page");
    expect(changeReview).toHaveAccessibleName(/Change review.*Current page/u);
    expect(
      screen.getByTestId("issues-subnav-issue-list"),
    ).not.toHaveAccessibleName(/Current page/u);

    navigationState.pathname = "/workspace/reef-test/issues/REEF-001";
    rerender(<IssuesSubNav />);
    const issueList = screen.getByTestId("issues-subnav-issue-list");
    expect(issueList).toHaveAttribute("aria-current", "page");
    expect(issueList).toHaveAccessibleName(/Issue list.*Current page/u);
    expect(
      screen.getByTestId("issues-subnav-change-review"),
    ).not.toHaveAccessibleName(/Current page/u);
  });
});
