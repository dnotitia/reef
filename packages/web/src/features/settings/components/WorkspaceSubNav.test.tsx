import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigationState = vi.hoisted(() => ({
  pathname: "/workspace/reef-test/settings/workspace",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useParams: () => ({ vault: "reef-test" }),
}));

// WorkspaceSubNav scopes its hrefs to the active vault (REEF-315) via
// useActiveVault, which calls useQuery; this test renders without a QueryClient,
// so resolve it to a fixed vault.
vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: "reef-test",
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

import { WorkspaceSubNav } from "./WorkspaceSubNav";

describe("WorkspaceSubNav (REEF-183)", () => {
  beforeEach(() => {
    navigationState.pathname = "/workspace/reef-test/settings/workspace";
  });

  it("renders the General and Members sub-views as addressable links (AC3)", () => {
    render(<WorkspaceSubNav />);
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute(
      "href",
      "/workspace/reef-test/settings/workspace",
    );
    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute(
      "href",
      "/workspace/reef-test/settings/workspace/members",
    );
  });

  it("activates General on the index route only", () => {
    render(<WorkspaceSubNav />);
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Members" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("activates Members on its route without also lighting up General", () => {
    navigationState.pathname =
      "/workspace/reef-test/settings/workspace/members";
    render(<WorkspaceSubNav />);
    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "General" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
