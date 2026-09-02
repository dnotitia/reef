import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigationState = vi.hoisted(() => ({
  pathname: "/workspace/reef-test/settings/workspace",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useParams: () => ({ vault: "reef-test" }),
}));

// SettingsTabs scopes its hrefs to the active vault (REEF-315) via
// useActiveVault, which calls useQuery; this test renders without a QueryClient,
// so resolve it to a fixed vault.
vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: "reef-test",
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

import { SettingsTabs } from "./SettingsTabs";

describe("SettingsTabs (REEF-183)", () => {
  beforeEach(() => {
    navigationState.pathname = "/workspace/reef-test/settings/workspace";
  });

  it("renders one addressable link per scope tab (AC1)", () => {
    render(<SettingsTabs />);
    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute(
      "href",
      "/workspace/reef-test/settings/workspace",
    );
    expect(screen.getByRole("link", { name: "Preferences" })).toHaveAttribute(
      "href",
      "/workspace/reef-test/settings/preferences",
    );
    expect(screen.getByRole("link", { name: "Deployment" })).toHaveAttribute(
      "href",
      "/workspace/reef-test/settings/deployment",
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
  // and the canonical `ring-brand-focus` focus ring, sourced from one shared module.
  it("uses the shared family dimensions and focus ring (REEF-261)", () => {
    render(<SettingsTabs />);
    const classes = screen
      .getByRole("link", { name: "Workspace" })
      .className.split(/\s+/);
    expect(classes).toContain("px-2");
    expect(classes).not.toContain("px-2.5");
    expect(classes).toContain("type-control");
    expect(classes).toContain("font-medium");
    expect(classes).toContain("focus-visible:ring-brand-focus");
  });

  it("uses a bounded three-column track so every tab remains addressable on narrow viewports", () => {
    render(<SettingsTabs />);
    const nav = screen.getByTestId("settings-tabs");
    expect(nav.className).toContain("w-full");
    expect(nav.className).toContain("max-w-full");
    expect(nav.className).toContain("grid-cols-3");

    for (const label of ["Workspace", "Preferences", "Deployment"]) {
      const link = screen.getByRole("link", { name: label });
      expect(link.className).toContain("min-w-0");
      expect(link).toBeVisible();
    }
  });

  it("keeps the Workspace tab active on its nested members route", () => {
    navigationState.pathname =
      "/workspace/reef-test/settings/workspace/members";
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
    navigationState.pathname = "/workspace/reef-test/settings/preferences";
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
