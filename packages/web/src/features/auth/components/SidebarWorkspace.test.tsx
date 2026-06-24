// fake-indexeddb/auto — useActiveVault reads/writes the active vault via Dexie.
import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush, navState, activeVaultMock } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  navState: { pathname: "/issues" },
  activeVaultMock: { loading: false },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => navState.pathname,
}));

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

// Partial mock: the real Dexie-backed hook by default (so the switch tests below
// exercise genuine behavior), but `activeVaultMock.loading` can force the
// first-paint loading branch for the skeleton-alignment regression (REEF-168),
// which RTL's effect flush otherwise skips past.
vi.mock("@/features/settings/hooks/useActiveVault", async (orig) => {
  const actual =
    await orig<typeof import("@/features/settings/hooks/useActiveVault")>();
  return {
    ...actual,
    useActiveVault: () => {
      const real = actual.useActiveVault();
      return activeVaultMock.loading
        ? { ...real, vault: "", isLoading: true }
        : real;
    },
  };
});

import { useViewStore } from "@/features/ui/stores/useViewStore";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { apiFetch } from "@/lib/apiClient";
import { getActiveVault, setActiveVault } from "@/lib/storage/config";
import { db } from "@/lib/storage/db";
import { SidebarWorkspace } from "./SidebarWorkspace";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <IntlTestProvider>{ui}</IntlTestProvider>
    </QueryClientProvider>
  );
}

function vaultsResponse(
  entries: ReadonlyArray<{ name: string; has_reef_config: boolean }>,
) {
  return new Response(
    JSON.stringify({
      vaults: entries.map((e) => ({
        name: e.name,
        description: null,
        status: "active",
        role: "owner",
        created_at: null,
        has_reef_config: e.has_reef_config,
      })),
    }),
    { status: 200 },
  );
}

function setupVaults(
  entries: ReadonlyArray<{ name: string; has_reef_config: boolean }>,
) {
  mockApiFetch.mockImplementation(async (url) => {
    const u = String(url);
    if (u.startsWith("/api/vaults")) return vaultsResponse(entries);
    return new Response("{}", { status: 200 });
  });
}

describe("SidebarWorkspace", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockPush.mockReset();
    navState.pathname = "/issues";
    activeVaultMock.loading = false;
    window.localStorage.clear();
    await db.config.clear();
    useViewStore.setState({ createWorkspaceDialogOpen: false });
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("shows the active vault name and monogram when expanded, with no brand rail (REEF-168)", async () => {
    await setActiveVault("reef-acme");
    setupVaults([{ name: "reef-acme", has_reef_config: true }]);

    render(wrap(<SidebarWorkspace collapsed={false} />));

    const trigger = await screen.findByTestId("sidebar-workspace-trigger");
    await waitFor(() => expect(trigger).toHaveTextContent("reef-acme"));
    expect(screen.getByTestId("workspace-monogram")).toHaveTextContent("RE");
    // The left brand rail was removed: the active-page rail is a nav
    // signal, and dropping it keeps this footer row symmetric with the account
    // row below it (REEF-168).
    expect(
      screen.queryByTestId("sidebar-workspace-rail"),
    ).not.toBeInTheDocument();
  });

  it("wraps the loading skeleton in the flex-1 text column so the chevron stays trailing (REEF-168)", async () => {
    activeVaultMock.loading = true;
    setupVaults([{ name: "reef-acme", has_reef_config: true }]);

    render(wrap(<SidebarWorkspace collapsed={false} />));

    const trigger = await screen.findByTestId("sidebar-workspace-trigger");
    // While loading, the name is a skeleton placeholder. It should sit inside the
    // flex-1 column (the same column the name uses once loaded), not as a bare
    // flex sibling — then does the trailing chevron stay pinned to the
    // row's right edge instead of jumping left during load. (The actual pixel
    // alignment is verified in a real browser; jsdom has no layout, so this
    // guards the structural contract the fix turns on.)
    const column = trigger.querySelector(".flex-1");
    expect(column).not.toBeNull();
    expect(column?.querySelector(".w-24")).not.toBeNull();
  });

  it("shows only the monogram with a title when collapsed (AC1)", async () => {
    await setActiveVault("reef-acme");
    setupVaults([{ name: "reef-acme", has_reef_config: true }]);

    render(wrap(<SidebarWorkspace collapsed={true} />));

    const trigger = await screen.findByTestId("sidebar-workspace-trigger");
    await waitFor(() => expect(trigger).toHaveAttribute("title", "reef-acme"));
    expect(screen.getByTestId("workspace-monogram")).toBeInTheDocument();
    // the monogram shows when collapsed — the "Workspace" label is hidden.
    expect(trigger).not.toHaveTextContent("Workspace");
  });

  it("opens an upward popover listing only reef-config vaults, marking the current one (AC2)", async () => {
    await setActiveVault("reef-acme");
    setupVaults([
      { name: "reef-acme", has_reef_config: true },
      { name: "reef-beta", has_reef_config: true },
      { name: "raw-vault", has_reef_config: false },
    ]);
    const user = userEvent.setup();

    render(wrap(<SidebarWorkspace collapsed={false} />));

    await user.click(await screen.findByTestId("sidebar-workspace-trigger"));

    const popover = await screen.findByTestId("workspace-switcher");
    // Opens upward — the side="top" content anchors to the trigger's top edge.
    expect(popover).toHaveClass("bottom-full");
    expect(
      await screen.findByTestId("workspace-switcher-option-reef-acme"),
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByTestId("workspace-switcher-option-reef-beta"),
    ).toBeInTheDocument();
    // Non-reef vaults are filtered out.
    expect(
      screen.queryByTestId("workspace-switcher-option-raw-vault"),
    ).not.toBeInTheDocument();
  });

  it("switches the active vault when another workspace is picked (AC2)", async () => {
    await setActiveVault("reef-acme");
    setupVaults([
      { name: "reef-acme", has_reef_config: true },
      { name: "reef-beta", has_reef_config: true },
    ]);
    const user = userEvent.setup();

    render(wrap(<SidebarWorkspace collapsed={false} />));

    await user.click(await screen.findByTestId("sidebar-workspace-trigger"));
    await user.click(
      await screen.findByTestId("workspace-switcher-option-reef-beta"),
    );

    await waitFor(async () => expect(await getActiveVault()).toBe("reef-beta"));
  });

  it("navigates to the new workspace's board on switch, unmounting vault-scoped pages", async () => {
    navState.pathname = "/activity";
    await setActiveVault("reef-acme");
    setupVaults([
      { name: "reef-acme", has_reef_config: true },
      { name: "reef-beta", has_reef_config: true },
    ]);
    const user = userEvent.setup();

    render(wrap(<SidebarWorkspace collapsed={false} />));

    await user.click(await screen.findByTestId("sidebar-workspace-trigger"));
    await user.click(
      await screen.findByTestId("workspace-switcher-option-reef-beta"),
    );

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/issues"));
  });

  it("does not navigate when re-picking the already-active workspace", async () => {
    navState.pathname = "/activity";
    await setActiveVault("reef-acme");
    setupVaults([{ name: "reef-acme", has_reef_config: true }]);
    const user = userEvent.setup();

    render(wrap(<SidebarWorkspace collapsed={false} />));

    await user.click(await screen.findByTestId("sidebar-workspace-trigger"));
    await user.click(
      await screen.findByTestId("workspace-switcher-option-reef-acme"),
    );

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("filters the workspace list by the search input (AC2)", async () => {
    await setActiveVault("reef-acme");
    setupVaults([
      { name: "reef-acme", has_reef_config: true },
      { name: "reef-beta", has_reef_config: true },
    ]);
    const user = userEvent.setup();

    render(wrap(<SidebarWorkspace collapsed={false} />));

    await user.click(await screen.findByTestId("sidebar-workspace-trigger"));
    await user.type(
      await screen.findByTestId("workspace-switcher-search"),
      "beta",
    );

    expect(
      screen.getByTestId("workspace-switcher-option-reef-beta"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-switcher-option-reef-acme"),
    ).not.toBeInTheDocument();
  });

  it("draws the switcher search input's ring on keyboard focus only (REEF-226)", async () => {
    await setActiveVault("reef-acme");
    setupVaults([{ name: "reef-acme", has_reef_config: true }]);
    const user = userEvent.setup();

    render(wrap(<SidebarWorkspace collapsed={false} />));

    await user.click(await screen.findByTestId("sidebar-workspace-trigger"));
    const search = await screen.findByTestId("workspace-switcher-search");
    expect(search.className).toContain("focus-visible:ring-brand/30");
    expect(search.className).not.toContain("focus:ring");
  });

  it("gives the trigger a focus-visible ring for keyboard users (REEF-172)", async () => {
    await setActiveVault("reef-acme");
    setupVaults([{ name: "reef-acme", has_reef_config: true }]);

    render(wrap(<SidebarWorkspace collapsed={false} />));

    // jsdom has no layout, so the visible ring is verified in a browser; this
    // guards the focus-visible token (the canonical button ring) the fix adds so
    // the trigger no longer focuses invisibly for Tab users.
    const trigger = await screen.findByTestId("sidebar-workspace-trigger");
    expect(trigger.className).toContain("focus-visible:ring-brand/40");
    expect(trigger.className).toContain("focus-visible:outline-none");
  });

  it("opts the search input out of autocomplete/spellcheck and uses an ellipsis placeholder (REEF-172)", async () => {
    await setActiveVault("reef-acme");
    setupVaults([{ name: "reef-acme", has_reef_config: true }]);
    const user = userEvent.setup();

    render(wrap(<SidebarWorkspace collapsed={false} />));

    await user.click(await screen.findByTestId("sidebar-workspace-trigger"));
    const search = await screen.findByTestId("workspace-switcher-search");
    // No password-manager / spellcheck noise on a workspace filter field, and
    // the placeholder follows the ellipsis (…) convention rather than "...".
    expect(search).toHaveAttribute("autocomplete", "off");
    expect(search).toHaveAttribute("spellcheck", "false");
    expect(search).toHaveAttribute("placeholder", "Search workspaces…");
  });

  it("always offers New workspace — even with zero reef vaults — and opens the create dialog (AC3)", async () => {
    setupVaults([{ name: "raw-vault", has_reef_config: false }]);
    const user = userEvent.setup();

    render(wrap(<SidebarWorkspace collapsed={false} />));

    await user.click(await screen.findByTestId("sidebar-workspace-trigger"));

    expect(
      await screen.findByTestId("workspace-switcher-empty"),
    ).toHaveTextContent(/No reef workspaces yet/i);
    const newWorkspace = screen.getByTestId("workspace-switcher-new");
    expect(newWorkspace).toBeInTheDocument();

    await user.click(newWorkspace);
    expect(useViewStore.getState().createWorkspaceDialogOpen).toBe(true);
  });

  it("shows a loading row instead of a false empty state while vaults load", async () => {
    await setActiveVault("reef-acme");
    // does not-resolving /api/vaults keeps the query pending.
    mockApiFetch.mockImplementation((url) =>
      String(url).startsWith("/api/vaults")
        ? new Promise<Response>(() => {})
        : Promise.resolve(new Response("{}", { status: 200 })),
    );
    const user = userEvent.setup();

    render(wrap(<SidebarWorkspace collapsed={false} />));

    await user.click(await screen.findByTestId("sidebar-workspace-trigger"));
    expect(
      await screen.findByTestId("workspace-switcher-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-switcher-empty"),
    ).not.toBeInTheDocument();
  });

  it("renders a New workspace entry alongside the populated list (AC3)", async () => {
    await setActiveVault("reef-acme");
    setupVaults([{ name: "reef-acme", has_reef_config: true }]);
    const user = userEvent.setup();

    render(wrap(<SidebarWorkspace collapsed={false} />));

    await user.click(await screen.findByTestId("sidebar-workspace-trigger"));
    const popover = await screen.findByTestId("workspace-switcher");
    expect(
      within(popover).getByTestId("workspace-switcher-new"),
    ).toBeInTheDocument();
  });

  it("sizes the switcher panel to the account-menu width so the footer menus align (REEF-171)", async () => {
    await setActiveVault("reef-acme");
    setupVaults([{ name: "reef-acme", has_reef_config: true }]);
    const user = userEvent.setup();

    render(wrap(<SidebarWorkspace collapsed={false} />));

    await user.click(await screen.findByTestId("sidebar-workspace-trigger"));
    const popover = await screen.findByTestId("workspace-switcher");
    // The panel should match the account menu's width (w-56) so the two
    // sidebar-footer menus share a right edge and stay within the sidebar
    // bounds; the previous w-60 was 16px wider than the trigger row and spilled
    // ~8px past the sidebar's edge (REEF-171). jsdom has no layout, so this
    // guards the width class the alignment fix turns on.
    expect(popover).toHaveClass("w-56");
    expect(popover).not.toHaveClass("w-60");
  });
});
