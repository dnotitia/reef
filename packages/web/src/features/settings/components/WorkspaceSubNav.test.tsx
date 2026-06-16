import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigationState = vi.hoisted(() => ({ pathname: "/settings/workspace" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

import { WorkspaceSubNav } from "./WorkspaceSubNav";

describe("WorkspaceSubNav (REEF-183)", () => {
  beforeEach(() => {
    navigationState.pathname = "/settings/workspace";
  });

  it("renders the General and Members sub-views as addressable links (AC3)", () => {
    render(<WorkspaceSubNav />);
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute(
      "href",
      "/settings/workspace",
    );
    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute(
      "href",
      "/settings/workspace/members",
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
    navigationState.pathname = "/settings/workspace/members";
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
