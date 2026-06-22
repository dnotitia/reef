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

  // REEF-261: tabs share the segmented-control family vocabulary. They aligned
  // to the canonical ViewSwitcher dimensions (`px-2`, not the prior `px-2.5`)
  // and the canonical `ring-brand` focus ring, sourced from one shared module.
  it("uses the shared family dimensions and focus ring (REEF-261)", () => {
    render(<SettingsTabs />);
    const classes = screen
      .getByRole("link", { name: "Workspace" })
      .className.split(/\s+/);
    expect(classes).toContain("px-2");
    expect(classes).not.toContain("px-2.5");
    expect(classes).toContain("text-[12px]");
    expect(classes).toContain("font-medium");
    expect(classes).toContain("focus-visible:ring-brand");
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
