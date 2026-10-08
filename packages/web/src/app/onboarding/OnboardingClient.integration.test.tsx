import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authState, authSessionState, mockReplace } = vi.hoisted(() => ({
  authState: {
    status: "active" as "active" | "inactive" | "checking" | "unavailable",
  },
  authSessionState: { established: false },
  mockReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
  useParams: () => ({}),
}));

vi.mock("@/features/auth/hooks/useAuthRedirect", () => ({
  retryAuthSession: vi.fn(),
  useAuthRedirect: () => authState.status,
}));

vi.mock("@/features/auth/components/AccountMenu", () => ({
  AccountMenu: () => null,
}));

vi.mock("@/lib/akb/authCoordinator", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/akb/authCoordinator")
  >("@/lib/akb/authCoordinator");
  return {
    ...actual,
    hasEstablishedAuthSession: () => authSessionState.established,
  };
});

vi.mock("@/features/settings/hooks/useGithubAppAvailable", () => ({
  useGithubAppAvailable: () => ({
    isAvailable: true,
    isLoading: false,
    appId: "123456",
  }),
}));

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/apiClient";
import * as activeVaultStorage from "@/lib/storage/config";
import { setActiveVault } from "@/lib/storage/config";
import { db } from "@/lib/storage/db";
import { OnboardingClient } from "./OnboardingClient";

const mockApiFetch = vi.mocked(apiFetch);
const pendingActiveVaultReads: Array<() => Promise<void>> = [];
let queryClient: QueryClient;

function wrap(ui: ReactNode) {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: 0, retry: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function emptyVaultsResponse() {
  return new Response(JSON.stringify({ vaults: [] }), { status: 200 });
}

function vaultsResponse(
  entries: ReadonlyArray<{
    name: string;
    installation_active: boolean | null;
  }>,
) {
  return new Response(
    JSON.stringify({
      vaults: entries.map((entry) => ({
        name: entry.name,
        description: null,
        status: "active",
        role: "owner",
        created_at: null,
        installation_active: entry.installation_active,
      })),
    }),
    { status: 200 },
  );
}

function setupVaultApi(
  entries: ReadonlyArray<{
    name: string;
    installation_active: boolean | null;
  }>,
) {
  mockApiFetch.mockImplementation(async (url) => {
    if (String(url) === "/api/vaults") return vaultsResponse(entries);
    if (String(url).startsWith("/api/repos")) {
      return new Response(JSON.stringify({ repos: [] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
}

describe("OnboardingClient and OnboardingPanel resume ownership", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    authState.status = "active";
    authSessionState.established = false;
    pendingActiveVaultReads.length = 0;
    await db.config.clear();
    setupVaultApi([]);
  });

  afterEach(async () => {
    await Promise.all(
      pendingActiveVaultReads.splice(0).map((resume) => resume()),
    );
    queryClient?.clear();
    vi.restoreAllMocks();
    await db.config.clear();
  });

  it("keeps the create form mounted after an empty list without refetching active vault", async () => {
    const readDexieActiveVault = activeVaultStorage.getActiveVault;
    const activeVaultRead = vi
      .spyOn(activeVaultStorage, "getActiveVault")
      .mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            pendingActiveVaultReads.push(async () => {
              try {
                resolve(await readDexieActiveVault());
              } catch (error) {
                reject(error);
              }
            });
          }),
      );

    render(
      wrap(<OnboardingClient appVersion="0.10.0" pageSubtitle="Welcome" />),
    );

    await waitFor(() => expect(pendingActiveVaultReads).toHaveLength(1));
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith("/api/vaults"),
    );

    await act(async () => {
      await pendingActiveVaultReads[0]();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(activeVaultRead).toHaveBeenCalledOnce();
    expect(screen.getByTestId("greenfield-vault-name-input")).toBeVisible();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows the create form after a raw-only list with no remembered target", async () => {
    setupVaultApi([{ name: "raw-vault", installation_active: false }]);

    render(
      wrap(<OnboardingClient appVersion="0.10.0" pageSubtitle="Welcome" />),
    );

    expect(
      await screen.findByTestId("greenfield-vault-name-input"),
    ).toBeVisible();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("keeps resume checks enabled for an established session during auth recovery", async () => {
    authState.status = "unavailable";
    authSessionState.established = true;
    setupVaultApi([]);

    render(
      wrap(<OnboardingClient appVersion="0.10.0" pageSubtitle="Welcome" />),
    );

    expect(
      await screen.findByTestId("greenfield-vault-name-input"),
    ).toBeVisible();
    expect(screen.getByTestId("onboarding-page")).toBeVisible();
  });

  it("routes a remembered unavailable workspace through the parent owner", async () => {
    await setActiveVault("reef-zeta");
    setupVaultApi([
      { name: "reef-zeta", installation_active: false },
      { name: "raw-vault", installation_active: false },
    ]);

    render(
      wrap(<OnboardingClient appVersion="0.10.0" pageSubtitle="Welcome" />),
    );

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/workspace/reef-zeta/issues"),
    );
    expect(screen.queryByTestId("greenfield-vault-name-input")).toBeNull();
    expect(mockReplace).toHaveBeenCalledOnce();
  });

  it("routes a remembered inactive workspace while another availability is unknown", async () => {
    await setActiveVault("reef-zeta");
    setupVaultApi([
      { name: "reef-alpha", installation_active: null },
      { name: "reef-zeta", installation_active: false },
    ]);

    render(
      wrap(<OnboardingClient appVersion="0.10.0" pageSubtitle="Welcome" />),
    );

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/workspace/reef-zeta/issues"),
    );
    expect(screen.queryByTestId("greenfield-vault-name-input")).toBeNull();
    expect(mockReplace).toHaveBeenCalledOnce();
  });

  it("resumes the remembered active workspace before ASCII fallback", async () => {
    await setActiveVault("reef-zeta");
    setupVaultApi([
      { name: "reef-alpha", installation_active: true },
      { name: "reef-zeta", installation_active: true },
    ]);

    render(
      wrap(<OnboardingClient appVersion="0.10.0" pageSubtitle="Welcome" />),
    );

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/workspace/reef-zeta/issues"),
    );
    expect(await activeVaultStorage.getActiveVault()).toBe("reef-zeta");
  });

  it("uses ASCII fallback when the remembered workspace is absent", async () => {
    await setActiveVault("missing");
    setupVaultApi([
      { name: "reef-zeta", installation_active: true },
      { name: "reef-alpha", installation_active: true },
    ]);

    render(
      wrap(<OnboardingClient appVersion="0.10.0" pageSubtitle="Welcome" />),
    );

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/workspace/reef-alpha/issues"),
    );
    expect(await activeVaultStorage.getActiveVault()).toBe("reef-alpha");
  });

  it("keeps onboarding pending while availability is unknown and retries before resuming", async () => {
    let vaultListAttempts = 0;
    mockApiFetch.mockImplementation(async (url) => {
      if (String(url) === "/api/vaults") {
        vaultListAttempts += 1;
        return vaultsResponse([
          {
            name: "reef-alpha",
            installation_active: vaultListAttempts === 1 ? null : true,
          },
        ]);
      }
      if (String(url).startsWith("/api/repos")) {
        return new Response(JSON.stringify({ repos: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const user = userEvent.setup();

    render(
      wrap(<OnboardingClient appVersion="0.10.0" pageSubtitle="Welcome" />),
    );

    expect(await screen.findByTestId("workspace-resume-error")).toBeVisible();
    expect(screen.queryByTestId("greenfield-vault-name-input")).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/workspace/reef-alpha/issues"),
    );
    expect(vaultListAttempts).toBe(2);
  });

  it("keeps creation available after retrying a failed empty vault list", async () => {
    let vaultListAttempts = 0;
    mockApiFetch.mockImplementation(async (url) => {
      if (String(url) === "/api/vaults") {
        vaultListAttempts += 1;
        return vaultListAttempts === 1
          ? new Response("failed", { status: 500 })
          : emptyVaultsResponse();
      }
      if (String(url).startsWith("/api/repos")) {
        return new Response(JSON.stringify({ repos: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const activeVaultRead = vi.spyOn(activeVaultStorage, "getActiveVault");
    const user = userEvent.setup();

    render(
      wrap(<OnboardingClient appVersion="0.10.0" pageSubtitle="Welcome" />),
    );

    expect(await screen.findByTestId("workspace-resume-error")).toBeVisible();
    expect(screen.queryByTestId("greenfield-vault-name-input")).toBeNull();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(
      await screen.findByTestId("greenfield-vault-name-input"),
    ).toBeVisible();
    expect(vaultListAttempts).toBe(2);
    expect(activeVaultRead).toHaveBeenCalledOnce();
  });
});
