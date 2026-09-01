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
    expect(screen.getByRole("link", { name: "Issue list" })).toHaveAttribute(
      "href",
      "/workspace/reef-test/issues",
    );
    expect(screen.getByRole("link", { name: "Change review" })).toHaveAttribute(
      "href",
      "/workspace/reef-test/issues/changes",
    );
  });

  it("marks the Issues route active only on the list surface", () => {
    render(<IssuesSubNav />);

    expect(screen.getByRole("link", { name: "Issue list" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Change review" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks change review active and keeps issue details in the list section", () => {
    navigationState.pathname = "/workspace/reef-test/issues/changes";
    const { rerender } = render(<IssuesSubNav />);

    expect(screen.getByRole("link", { name: "Change review" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Issue list" }),
    ).not.toHaveAttribute("aria-current");

    navigationState.pathname = "/workspace/reef-test/issues/REEF-001";
    rerender(<IssuesSubNav />);
    expect(screen.getByRole("link", { name: "Issue list" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
