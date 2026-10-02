import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { EnrichedVaultSummary } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: mockApiFetch,
  throwHttpError: vi.fn(async (response: Response) => {
    throw new Error(`HTTP ${response.status}`);
  }),
}));

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

describe("WorkspaceAccessDenied", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ vaults: [] }), { status: 200 }),
    );
  });

  it("lists only the user's ready Reef workspaces as state-free switch links", () => {
    renderDenied([vault("reef-acme", true), vault("raw", false)]);

    const link = screen.getByTestId("access-denied-workspace-reef-acme");
    expect(link).toHaveAttribute("href", "/workspace/reef-acme/issues");
    expect(link.closest("nav")).toHaveClass("bg-surface-subtle");
    expect(link).not.toHaveTextContent(/ready|blocked|setup/i);
    expect(screen.queryByTestId("access-denied-workspace-raw")).toBeNull();
    expect(screen.queryByTestId("access-denied-onboarding")).toBeNull();
  });

  it("offers onboarding when the user has no ready Reef workspace", () => {
    renderDenied([vault("raw", false)]);

    expect(screen.getByTestId("access-denied-onboarding")).toHaveAttribute(
      "href",
      "/onboarding",
    );
    expect(screen.queryByTestId("access-denied-workspace-raw")).toBeNull();
  });

  it("keeps the authenticated account menu available", () => {
    renderDenied([vault("reef-acme", true)]);

    expect(screen.getByRole("button", { name: "Account menu" })).toBeVisible();
  });

  it("summarizes only the requested blocked workspace for a reader", () => {
    renderDenied([vault("reef-acme", true)], "reef-blocked", {
      role: "reader",
      installationStatus: "blocked",
    });

    const status = screen.getByTestId("workspace-installation-reef-blocked");
    expect(status).toHaveAttribute("data-status", "management_required");
    expect(
      screen.getByRole("heading", { name: "This workspace needs setup" }),
    ).toBeVisible();
    expect(status).toHaveTextContent(
      "This workspace needs an owner or admin before it can be used.",
    );
    expect(status).toHaveTextContent(
      "Ask a workspace owner or admin to check the setup.",
    );
    expect(screen.getByRole("button", { name: "Check status" })).toBeVisible();
    expect(screen.queryByTestId("installation-details-disclosure")).toBeNull();
    expect(screen.queryByTestId("installation-blocked-guidance")).toBeNull();
    expect(screen.queryByText(/AKB installation operator/i)).toBeNull();
  });

  it("lets an owner recheck current-target status without showing diagnostics", () => {
    renderDenied([vault("reef-acme", true)], "reef-blocked", {
      role: "owner",
      installationStatus: "blocked",
    });

    const surface = screen.getByTestId("workspace-access-denied");
    expect(surface).toHaveClass("min-h-screen", "py-16");
    expect(surface).not.toHaveClass("h-screen");
    const status = screen.getByTestId("workspace-installation-reef-blocked");
    expect(status).toHaveAttribute("data-status", "blocked");
    expect(status).toHaveTextContent("Impact");
    expect(status).toHaveTextContent("Next step");
    expect(status).toHaveTextContent("Who can act");
    expect(screen.getByRole("button", { name: "Check status" })).toBeVisible();
    expect(screen.queryByTestId("installation-details-disclosure")).toBeNull();
    expect(screen.queryByTestId("installation-blocked-guidance")).toBeNull();
  });
});
