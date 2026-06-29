import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const activeVault = vi.hoisted(() => ({
  current: { vault: "reef-acme", isLoading: false } as {
    vault: string;
    isLoading: boolean;
  },
}));

const setActiveVault = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    ...activeVault.current,
    refetch: () => Promise.resolve(),
  }),
  useSetActiveVault: () => ({
    mutate: vi.fn(),
    mutateAsync: setActiveVault,
    isPending: false,
  }),
}));

import { useViewStore } from "@/features/ui/stores/useViewStore";
import { apiFetch } from "@/lib/apiClient";
import { ActiveWorkspaceSection } from "./ActiveWorkspaceSection";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function vaultsResponse(
  vaults: Array<{ name: string; has_reef_config: boolean }>,
) {
  return new Response(
    JSON.stringify({
      vaults: vaults.map((v) => ({
        name: v.name,
        description: null,
        status: "active",
        role: "owner",
        created_at: null,
        has_reef_config: v.has_reef_config,
      })),
    }),
    { status: 200 },
  );
}

describe("ActiveWorkspaceSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useViewStore.setState({ createWorkspaceDialogOpen: false });
    activeVault.current = { vault: "reef-acme", isLoading: false };
    setActiveVault.mockResolvedValue("reef-acme");
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/vaults")) {
        return vaultsResponse([{ name: "reef-acme", has_reef_config: true }]);
      }
      return new Response("{}", { status: 200 });
    });
  });

  it("renders the active-workspace scope section framed as a personal choice", async () => {
    render(wrap(<ActiveWorkspaceSection />));
    expect(
      await screen.findByTestId("active-workspace-section"),
    ).toBeInTheDocument();
    // AC2: framed as a personal, per-user choice — distinct from the shared,
    // permission-gated workspace settings below.
    expect(screen.getByText(/personal/i)).toBeInTheDocument();
  });

  it("calls /api/vaults to populate the workspace list", async () => {
    render(wrap(<ActiveWorkspaceSection />));
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith("/api/vaults"),
    );
  });

  it("excludes vaults without a reef config from the workspace picker (matches onboarding)", async () => {
    // A vault with has_reef_config=false is a dead-end active workspace (reef
    // does not read issues there and Settings offers no init path), so the picker
    // should filter it out exactly like onboarding does (REEF-143).
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/vaults")) {
        return vaultsResponse([
          { name: "reef-acme", has_reef_config: true },
          { name: "plain-vault", has_reef_config: false },
        ]);
      }
      return new Response("{}", { status: 200 });
    });

    render(wrap(<ActiveWorkspaceSection />));

    // Open the (non-Radix) workspace popover; options live in the same root.
    fireEvent.click(await screen.findByTestId("active-vault-trigger"));

    expect(
      await screen.findByTestId("active-vault-option-reef-acme"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("active-vault-option-plain-vault"),
    ).not.toBeInTheDocument();
  });

  it("persists the picked workspace and routes to it under the new vault (REEF-315)", async () => {
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/vaults")) {
        return vaultsResponse([
          { name: "reef-acme", has_reef_config: true },
          { name: "reef-beta", has_reef_config: true },
        ]);
      }
      return new Response("{}", { status: 200 });
    });

    render(wrap(<ActiveWorkspaceSection />));
    fireEvent.click(await screen.findByTestId("active-vault-trigger"));
    fireEvent.click(await screen.findByTestId("active-vault-option-reef-beta"));

    await waitFor(() =>
      expect(setActiveVault).toHaveBeenCalledWith("reef-beta"),
    );
    // The active vault is the URL segment now, so the picker must navigate to
    // the selected workspace's settings tab rather than only writing Dexie.
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        "/workspace/reef-beta/settings/workspace",
      ),
    );
  });

  it("opens the create-workspace dialog from the New workspace button (REEF-147)", async () => {
    // The create entry point lives next to the switcher and reuses REEF-146's
    // globally-mounted dialog via the shared useViewStore flag.
    render(wrap(<ActiveWorkspaceSection />));

    const createButton = await screen.findByTestId("active-workspace-create");
    expect(useViewStore.getState().createWorkspaceDialogOpen).toBe(false);

    fireEvent.click(createButton);

    expect(useViewStore.getState().createWorkspaceDialogOpen).toBe(true);
  });

  it("shows the create entry point regardless of role and without gating", async () => {
    // Creating a workspace makes a new vault — it is not an edit to the active
    // one — so a read viewer should still reach it. The section takes no
    // canEdit prop, so the button is consistently present and enabled (akb makes the
    // final create-permission call) (REEF-147).
    render(wrap(<ActiveWorkspaceSection />));

    const createButton = await screen.findByTestId("active-workspace-create");
    expect(createButton).toBeEnabled();
  });

  it("renders its heading at group weight, not the muted uppercase leaf style (REEF-174)", async () => {
    // The scope selector should not read smaller than the group it governs: it
    // carries foreground weight, not the uppercase muted leaf-label styling
    // that made it look like an individual setting.
    render(wrap(<ActiveWorkspaceSection />));
    const heading = await screen.findByRole("heading", {
      name: "Active Workspace",
      level: 2,
    });
    expect(heading.className).toContain("text-foreground");
    expect(heading.className).not.toMatch(/uppercase/);
    expect(heading.className).not.toMatch(/text-muted-foreground/);
  });

  it("announces the save result through a polite live region (REEF-174)", async () => {
    // The save outcome appears asynchronously, so it should live in an
    // consistently-mounted aria-live region to be announced when it arrives.
    render(wrap(<ActiveWorkspaceSection />));
    const status = await screen.findByTestId("active-workspace-save-status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});
