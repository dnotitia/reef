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

function vault(name: string, hasReefConfig: boolean): EnrichedVaultSummary {
  return {
    name,
    has_reef_config: hasReefConfig,
  } as EnrichedVaultSummary;
}

function renderDenied(vaults: EnrichedVaultSummary[], denied = "reef-other") {
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
});
