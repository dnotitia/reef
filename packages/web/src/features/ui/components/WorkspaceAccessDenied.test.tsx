import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { EnrichedVaultSummary } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/features/auth/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    data: { display_name: "Alice Example", email: "alice@example.com" },
    isLoading: false,
  }),
}));
import { WorkspaceAccessDenied } from "./WorkspaceAccessDenied";

function vault(
  name: string,
  ready: boolean,
  role?: string,
): EnrichedVaultSummary {
  return {
    name,
    installation_status: ready ? "ready" : "not_installed",
    role,
  } as EnrichedVaultSummary;
}

function renderDenied(
  vaults: EnrichedVaultSummary[],
  denied = "reef-other",
  options: {
    role?: string;
    installationStatus?: EnrichedVaultSummary["installation_status"];
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlTestProvider>
        <WorkspaceAccessDenied
          appVersion="0.10.0"
          vault={denied}
          vaults={vaults}
          role={options.role}
          installationStatus={options.installationStatus}
        />
      </IntlTestProvider>
    </QueryClientProvider>,
  );
}

describe("WorkspaceAccessDenied (REEF-315 AC5)", () => {
  it("lists only the user's reef workspaces as switch links", () => {
    renderDenied([vault("reef-acme", true), vault("raw", false)]);

    const link = screen.getByTestId("access-denied-workspace-reef-acme");
    expect(link).toHaveAttribute("href", "/workspace/reef-acme/issues");
    expect(link.closest("nav")).toHaveClass("bg-surface-subtle");
    // Non-reef vaults are not offered as switch targets.
    expect(
      screen.queryByTestId("access-denied-workspace-raw"),
    ).not.toBeInTheDocument();
    // No silent fallback: the onboarding CTA appears when there are no
    // reef workspaces to switch to.
    expect(
      screen.queryByTestId("access-denied-onboarding"),
    ).not.toBeInTheDocument();
  });

  it("offers an onboarding path when the user has no reef workspaces", () => {
    renderDenied([vault("raw", false)]);

    const cta = screen.getByTestId("access-denied-onboarding");
    expect(cta).toHaveAttribute("href", "/onboarding");
    expect(
      screen.queryByTestId("access-denied-workspace-raw"),
    ).not.toBeInTheDocument();
  });

  it("keeps the authenticated account menu available as a secondary utility", () => {
    renderDenied([vault("reef-acme", true)]);

    expect(
      screen.getByRole("button", { name: "Account menu" }),
    ).toBeInTheDocument();
  });

  it("keeps a reader's blocked Vault guidance minimal and exposes a status recheck", () => {
    renderDenied([vault("reef-acme", true)], "reef-blocked", {
      role: "reader",
      installationStatus: "blocked",
    });

    expect(
      screen.getByTestId("workspace-installation-reef-blocked"),
    ).toHaveAttribute("data-status", "management_required");
    expect(
      screen.getByRole("heading", { name: "Workspace availability" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/ask a workspace owner or admin/i)).toHaveLength(
      1,
    );
    expect(
      screen.getByRole("button", { name: "Check status" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/AKB has blocked/i)).not.toBeInTheDocument();
  });

  it("keeps the access heading centered while the installation card has its own left alignment", () => {
    renderDenied([vault("reef-acme", true)], "reef-blocked", {
      role: "owner",
      installationStatus: "blocked",
    });

    const surface = screen.getByTestId("workspace-access-denied");
    expect(surface).toHaveClass("min-h-screen", "py-16");
    expect(surface).not.toHaveClass("h-screen");
    expect(
      screen.getByTestId("workspace-installation-reef-blocked"),
    ).toHaveClass("text-left");
    expect(
      screen.getByRole("heading", { name: "Workspace availability" }),
    ).toBeInTheDocument();
  });
});
