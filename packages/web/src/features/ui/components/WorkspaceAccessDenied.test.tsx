import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { EnrichedVaultSummary } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    onCheckStatus?: () => Promise<void>;
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
          onCheckStatus={options.onCheckStatus ?? (async () => undefined)}
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

  it("keeps an existing unavailable workspace in its entry guidance", () => {
    renderDenied([vault("reef-target", false, "owner")], "reef-target", {
      role: "owner",
      installationStatus: "uninstalled",
    });

    expect(
      screen.getByTestId("workspace-installation-reef-target"),
    ).toBeVisible();
    expect(screen.queryByTestId("access-denied-onboarding")).toBeNull();
    expect(
      screen.queryByText("You don't have any reef workspaces yet."),
    ).toBeNull();
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
      screen.getByRole("heading", {
        name: "You don't have access to this workspace",
      }),
    ).toBeVisible();
    expect(status).toHaveTextContent("This workspace can't be used right now.");
    expect(status).toHaveTextContent(
      "Check the workspace status again. If it remains unavailable, ask a workspace owner or admin to check it.",
    );
    expect(screen.getByRole("button", { name: "Check status" })).toBeVisible();
    expect(
      screen.queryByTestId("installation-diagnostics-link-reef-blocked"),
    ).toBeNull();
    expect(screen.queryByTestId("installation-details-disclosure")).toBeNull();
    expect(screen.queryByTestId("installation-blocked-guidance")).toBeNull();
    expect(screen.queryByText(/AKB installation operator/i)).toBeNull();
  });

  it.each([
    { role: "owner", state: "not_installed", visibleState: "not_installed" },
    {
      role: "reader",
      state: "not_installed",
      visibleState: "management_required",
    },
    { role: "owner", state: "uninstalled", visibleState: "uninstalled" },
    {
      role: "reader",
      state: "uninstalled",
      visibleState: "management_required",
    },
  ] as const)(
    "guides $role into $state workspace without setup mutations",
    async ({ role, state, visibleState }) => {
      const onCheckStatus = vi.fn(async () => undefined);
      renderDenied([vault("reef-acme", true)], "reef-target", {
        role,
        installationStatus: state,
        onCheckStatus,
      });

      const surface = screen.getByTestId("workspace-access-denied");
      expect(surface).toHaveClass("min-h-screen", "py-16");
      expect(surface).not.toHaveClass("h-screen");
      const status = screen.getByTestId("workspace-installation-reef-target");
      expect(status).toHaveAttribute("data-status", visibleState);
      expect(status).toHaveTextContent("Impact");
      expect(status).toHaveTextContent("Next step");
      expect(status).toHaveTextContent("Who can act");
      expect(status).toHaveTextContent(
        role === "owner"
          ? "Check the workspace status again, or open its settings to review setup details."
          : "Check the workspace status again. If it remains unavailable, ask a workspace owner or admin to check it.",
      );
      const checkStatusButton = screen.getByRole("button", {
        name: "Check status",
      });
      expect(checkStatusButton).toBeVisible();
      expect(
        screen.queryByRole("button", {
          name: /Set up Reef|Restore installation|Request fresh setup/,
        }),
      ).toBeNull();
      expect(
        screen.queryByTestId("installation-details-disclosure"),
      ).toBeNull();
      expect(screen.queryByTestId("installation-blocked-guidance")).toBeNull();

      const diagnostics = screen.queryByTestId(
        "installation-diagnostics-link-reef-target",
      );
      if (role === "owner") {
        expect(diagnostics).toHaveAttribute(
          "href",
          "/workspace/reef-target/settings/workspace",
        );
      } else {
        expect(diagnostics).toBeNull();
      }

      await userEvent.setup().click(checkStatusButton);
      await waitFor(() => expect(onCheckStatus).toHaveBeenCalledOnce());
      expect(
        mockApiFetch.mock.calls.some(
          ([url, init]) =>
            init?.method === "POST" && String(url).endsWith("/installation"),
        ),
      ).toBe(false);
    },
  );

  it("does not call an unknown installation state a setup requirement", () => {
    renderDenied([], "reef-unknown", {
      role: "owner",
      installationStatus: "unknown",
    });

    expect(
      screen.getByRole("heading", {
        name: "You don't have access to this workspace",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "This workspace needs setup" }),
    ).toBeNull();
    expect(
      screen.getByTestId("workspace-installation-reef-unknown"),
    ).toHaveAttribute("data-status", "unknown");
  });
});
