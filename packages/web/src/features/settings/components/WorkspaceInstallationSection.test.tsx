import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaces = vi.hoisted(() => ({
  resolving: false,
  current: [] as Array<{
    name: string;
    role: string;
    installation_status: "ready" | "uninstalled" | "blocked";
  }>,
}));

vi.mock("@/features/settings/hooks/useWorkspaceAccess", () => ({
  useWorkspaceAccess: () => ({
    role: "owner",
    isResolving: workspaces.resolving,
  }),
}));

vi.mock("@/features/settings/hooks/useVaults", () => ({
  useVaults: () => ({
    data: workspaces.current,
    isPending: workspaces.resolving,
  }),
}));

import { WorkspaceInstallationSection } from "./WorkspaceInstallationSection";

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <IntlTestProvider>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </IntlTestProvider>
  );
}

describe("WorkspaceInstallationSection", () => {
  beforeEach(() => {
    workspaces.resolving = false;
    workspaces.current = [
      { name: "reef-current", role: "owner", installation_status: "ready" },
      {
        name: "reef-restore",
        role: "owner",
        installation_status: "uninstalled",
      },
      { name: "reef-blocked", role: "reader", installation_status: "blocked" },
      {
        name: "reef-other-ready",
        role: "owner",
        installation_status: "ready",
      },
    ];
  });

  it("holds installation space while workspace access is resolving", () => {
    workspaces.resolving = true;
    render(wrap(<WorkspaceInstallationSection vault="reef-current" />));

    expect(screen.getByTestId("workspace-installation-loading")).toBeVisible();
    expect(
      screen.queryByTestId("workspace-installation-reef-current"),
    ).not.toBeInTheDocument();
  });

  it("keeps restore actions reachable for other accessible uninstalled workspaces", () => {
    render(wrap(<WorkspaceInstallationSection vault="reef-current" />));

    expect(
      screen.getByTestId("workspace-installation-reef-current"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("installation-reef-restore-restore"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("installation-reef-restore-fresh"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workspace-installation-reef-blocked"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-installation-reef-other-ready"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("installation-reef-blocked-restore"),
    ).not.toBeInTheDocument();
  });
});
