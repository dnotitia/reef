import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigationState = vi.hoisted(() => ({ pathname: "/settings/workspace" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

import { SettingsTabs } from "./SettingsTabs";

describe("SettingsTabs (REEF-183)", () => {
  beforeEach(() => {
    navigationState.pathname = "/settings/workspace";
  });

  it("renders one addressable link per scope tab (AC1)", () => {
    render(<SettingsTabs />);
    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute(
      "href",
      "/settings/workspace",
    );
    expect(screen.getByRole("link", { name: "Preferences" })).toHaveAttribute(
      "href",
      "/settings/preferences",
    );
    expect(screen.getByRole("link", { name: "Deployment" })).toHaveAttribute(
      "href",
      "/settings/deployment",
    );
  });

  it("marks the active tab with aria-current=page and a visible focus ring (AC4)", () => {
    render(<SettingsTabs />);
    const workspace = screen.getByRole("link", { name: "Workspace" });
    expect(workspace).toHaveAttribute("aria-current", "page");
    expect(workspace.className).toContain("focus-visible:ring-2");
    // Inactive tabs carry no aria-current.
    expect(
      screen.getByRole("link", { name: "Preferences" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("keeps the Workspace tab active on its nested members route", () => {
    navigationState.pathname = "/settings/workspace/members";
    render(<SettingsTabs />);
    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Preferences" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("activates the Preferences tab on its own route", () => {
    navigationState.pathname = "/settings/preferences";
    render(<SettingsTabs />);
    expect(screen.getByRole("link", { name: "Preferences" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Workspace" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
