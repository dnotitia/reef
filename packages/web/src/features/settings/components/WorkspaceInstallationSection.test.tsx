import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaces = vi.hoisted(() => ({
  resolving: false,
  role: "owner",
  current: [] as Array<{
    name: string;
    role: string;
    installation_status: "ready" | "uninstalled" | "blocked" | "not_installed";
  }>,
}));
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: mockApiFetch,
  throwHttpError: vi.fn(async (response: Response) => {
    throw new Error(`HTTP ${response.status}`);
  }),
}));

vi.mock("@/features/settings/hooks/useWorkspaceAccess", () => ({
  useWorkspaceAccess: () => ({
    role: workspaces.role,
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
    workspaces.role = "owner";
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
    mockApiFetch.mockReset();
  });

  it("holds the selected workspace section while access is resolving", () => {
    workspaces.resolving = true;
    render(wrap(<WorkspaceInstallationSection vault="reef-current" />));

    expect(screen.getByTestId("workspace-installation-loading")).toBeVisible();
    expect(
      screen.queryByTestId("workspace-installation-reef-current"),
    ).not.toBeInTheDocument();
  });

  it("shows no setup task to a writer when the selected workspace is ready", () => {
    workspaces.role = "writer";
    render(wrap(<WorkspaceInstallationSection vault="reef-current" />));

    expect(
      screen.queryByTestId("workspace-installation-section"),
    ).not.toBeInTheDocument();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("shows selected-workspace diagnostics only as a lazy owner disclosure", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          installation_status: "ready",
          installation: {
            installationId: "33333333-3333-4333-8333-333333333333",
            appId: "11111111-1111-4111-8111-111111111111",
            vaultId: "22222222-2222-4222-8222-222222222222",
            lifecycle: "active",
            blockedReason: null,
            desiredRelease: {
              id: "44444444-4444-4444-8444-444444444444",
              version: "2.0.0",
            },
            currentRelease: {
              id: "55555555-5555-4555-8555-555555555555",
              version: "1.0.0",
            },
            observed: {
              generation: 4,
              observedAt: "2026-10-02T02:00:00.000Z",
              release: {
                id: "55555555-5555-4555-8555-555555555555",
                version: "1.0.0",
              },
              schemaFingerprint: "observed-fingerprint",
              grantGeneration: 3,
            },
            desiredGrantGeneration: 4,
            latestGrant: { generation: 4, status: "active", capabilities: [] },
            activeGrant: { generation: 3, status: "active", capabilities: [] },
            drift: {
              release: {
                status: "mismatch",
                desired: {
                  id: "44444444-4444-4444-8444-444444444444",
                  version: "2.0.0",
                },
                observed: {
                  id: "55555555-5555-4555-8555-555555555555",
                  version: "1.0.0",
                },
              },
              schema: {
                status: "unknown",
                expected: "target-fingerprint",
                observed: null,
              },
              grant: {
                status: "mismatch",
                desiredGeneration: 4,
                observedGeneration: 3,
              },
              overall: "drifted",
              reasons: ["release_mismatch", "grant_mismatch"],
              unknownDimensions: ["schema"],
            },
          },
        }),
        { status: 200 },
      ),
    );
    render(wrap(<WorkspaceInstallationSection vault="reef-current" />));

    const section = screen.getByTestId("workspace-installation-section");
    const disclosure = screen.getByTestId("installation-details-disclosure");
    expect(section).toBeVisible();
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.queryByText("Ready to use")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-installation-reef-restore"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-installation-reef-blocked"),
    ).not.toBeInTheDocument();
    expect(mockApiFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Technical details"));
    fireEvent(disclosure, new Event("toggle"));
    expect(await screen.findByTestId("installation-details")).toBeVisible();
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/vaults/reef-current/installation",
      { cache: "no-store" },
    );
  });

  it("summarizes only the selected blocked workspace and keeps member actions limited", () => {
    workspaces.role = "reader";
    workspaces.current = [
      { name: "reef-current", role: "reader", installation_status: "blocked" },
      {
        name: "reef-restore",
        role: "owner",
        installation_status: "uninstalled",
      },
      { name: "reef-other-ready", role: "owner", installation_status: "ready" },
    ];
    render(wrap(<WorkspaceInstallationSection vault="reef-current" />));

    const current = screen.getByTestId("workspace-installation-reef-current");
    expect(current).toHaveAttribute("data-status", "management_required");
    expect(current).toHaveTextContent("Impact");
    expect(current).toHaveTextContent("Next step");
    expect(current).toHaveTextContent("Who can act");
    expect(current).toHaveTextContent(
      "Ask a workspace owner or admin to check the setup.",
    );
    expect(screen.getByRole("button", { name: "Check status" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Restore installation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-installation-reef-restore"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("installation-details-disclosure"),
    ).not.toBeInTheDocument();
  });

  it("resets installation actions when the selected workspace role changes", () => {
    workspaces.current = [
      { name: "reef-current", role: "owner", installation_status: "blocked" },
    ];
    const view = render(
      wrap(<WorkspaceInstallationSection vault="reef-current" />),
    );

    expect(
      screen.getByTestId("workspace-installation-reef-current"),
    ).toHaveAttribute("data-status", "blocked");

    workspaces.role = "reader";
    workspaces.current = [
      {
        name: "reef-current",
        role: "reader",
        installation_status: "uninstalled",
      },
    ];
    view.rerender(wrap(<WorkspaceInstallationSection vault="reef-current" />));
    expect(
      screen.getByTestId("workspace-installation-reef-current"),
    ).toHaveAttribute("data-status", "management_required");
    expect(
      screen.queryByRole("button", { name: "Restore installation" }),
    ).not.toBeInTheDocument();

    workspaces.role = "admin";
    workspaces.current = [
      {
        name: "reef-current",
        role: "admin",
        installation_status: "uninstalled",
      },
    ];
    view.rerender(wrap(<WorkspaceInstallationSection vault="reef-current" />));
    expect(
      screen.getByRole("button", { name: "Restore installation" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Request fresh setup" }),
    ).toBeVisible();
  });
});
