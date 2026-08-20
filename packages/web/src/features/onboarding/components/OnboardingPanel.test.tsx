// fake-indexeddb/auto - OnboardingPanel reads/writes the active vault via Dexie.
import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useParams: () => ({}),
}));

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const appState = vi.hoisted(() => ({
  current: {
    isAvailable: true,
    isLoading: false,
    appId: "123456" as string | null,
  },
}));
vi.mock("@/features/settings/hooks/useGithubAppAvailable", () => ({
  useGithubAppAvailable: () => appState.current,
}));

import { apiFetch } from "@/lib/apiClient";
import { getActiveVault, setActiveVault } from "@/lib/storage/config";
import { db } from "@/lib/storage/db";
import { OnboardingPanel } from "./OnboardingPanel";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
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

interface MockApiOptions {
  vaults?: ReadonlyArray<{ name: string; has_reef_config: boolean }>;
  repos?: ReadonlyArray<{ full_name: string; id: number }>;
  postStatus?: number;
  postBody?: unknown;
}

function setupMockApi({
  vaults = [],
  repos = [],
  postStatus = 200,
  postBody = {
    name: "reef-new",
    config: { project_prefix: "REEF", monitored_repos: [] },
  },
}: MockApiOptions = {}) {
  mockApiFetch.mockImplementation(async (url, init) => {
    const u = String(url);
    if (u.startsWith("/api/vaults") && init?.method === "POST") {
      return new Response(JSON.stringify(postBody), { status: postStatus });
    }
    if (u.startsWith("/api/vaults")) return vaultsResponse(vaults);
    if (u.startsWith("/api/repos")) {
      return new Response(JSON.stringify({ repos }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
}

function postVaultCall() {
  return mockApiFetch.mock.calls.find(
    ([url, init]) => String(url) === "/api/vaults" && init?.method === "POST",
  );
}

describe("OnboardingPanel", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockPush.mockReset();
    mockReplace.mockReset();
    appState.current = {
      isAvailable: true,
      isLoading: false,
      appId: "123456",
    };
    window.localStorage.clear();
    await db.config.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("renders the greenfield form by default with REEF as the prefix", async () => {
    setupMockApi();

    render(wrap(<OnboardingPanel />));

    expect(await screen.findByTestId("onboarding-panel")).toBeInTheDocument();
    expect(screen.getByTestId("greenfield-vault-name-input")).toBeVisible();
    expect(screen.getByTestId("greenfield-project-prefix-input")).toHaveValue(
      "REEF",
    );
  });

  it("creates a new workspace, stores it as active, and routes to /issues", async () => {
    setupMockApi();
    const user = userEvent.setup();

    render(wrap(<OnboardingPanel />));

    await user.type(
      await screen.findByTestId("greenfield-vault-name-input"),
      "reef-new",
    );
    await user.click(screen.getByTestId("greenfield-create-btn"));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/workspace/reef-new/issues"),
    );
    expect(await getActiveVault()).toBe("reef-new");

    const call = postVaultCall();
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      name: "reef-new",
      project_prefix: "REEF",
      monitored_repos: [],
    });
  });

  it("includes optional monitored repos (with github_id) in the create request", async () => {
    // The repo picker fetches through the deployment-managed GitHub App.
    setupMockApi({
      repos: [
        { full_name: "octo/cat", id: 111 },
        { full_name: "octo/dog", id: 222 },
      ],
      postBody: {
        name: "reef-new",
        config: {
          project_prefix: "REEF",
          monitored_repos: [{ github_id: 111, owner: "octo", name: "cat" }],
        },
      },
    });
    const user = userEvent.setup();

    render(wrap(<OnboardingPanel />));

    await user.click(
      await screen.findByTestId("greenfield-monitored-repos-trigger"),
    );
    await user.click(
      await screen.findByTestId("greenfield-monitored-repos-option-octo/cat"),
    );
    const vaultNameInput = await screen.findByTestId(
      "greenfield-vault-name-input",
    );
    await user.clear(vaultNameInput);
    await user.type(vaultNameInput, "reef-new");
    expect(vaultNameInput).toHaveValue("reef-new");
    await user.click(screen.getByTestId("greenfield-create-btn"));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/workspace/reef-new/issues"),
    );
    const call = postVaultCall();
    expect(JSON.parse(String(call?.[1]?.body)).monitored_repos).toEqual([
      { github_id: 111, owner: "octo", name: "cat" },
    ]);
  });

  it("automatically resumes the remembered configured workspace", async () => {
    await setActiveVault("reef-zeta");
    setupMockApi({
      vaults: [
        { name: "reef-alpha", has_reef_config: true },
        { name: "reef-zeta", has_reef_config: true },
        { name: "raw-vault", has_reef_config: false },
      ],
    });

    render(wrap(<OnboardingPanel />));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/workspace/reef-zeta/issues"),
    );
    expect(screen.queryByTestId("greenfield-vault-name-input")).toBeNull();
    expect(await getActiveVault()).toBe("reef-zeta");
  });

  it("uses explicit ASCII order when the remembered workspace is invalid", async () => {
    await setActiveVault("missing");
    setupMockApi({
      vaults: [
        { name: "reef-zeta", has_reef_config: true },
        { name: "reef-alpha", has_reef_config: true },
      ],
    });

    render(wrap(<OnboardingPanel />));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/workspace/reef-alpha/issues"),
    );
    expect(await getActiveVault()).toBe("reef-alpha");
  });

  it("persists and navigates once under Strict Effects", async () => {
    setupMockApi({
      vaults: [{ name: "reef-acme", has_reef_config: true }],
    });

    render(
      wrap(
        <StrictMode>
          <OnboardingPanel />
        </StrictMode>,
      ),
    );

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/workspace/reef-acme/issues"),
    );
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(await getActiveVault()).toBe("reef-acme");
  });

  it("shows onboarding only after a successful raw-only response", async () => {
    setupMockApi({
      vaults: [{ name: "raw-vault", has_reef_config: false }],
    });

    render(wrap(<OnboardingPanel />));

    expect(
      await screen.findByTestId("greenfield-vault-name-input"),
    ).toBeVisible();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not flash the form while vaults are loading", async () => {
    let resolveVaults!: (response: Response) => void;
    mockApiFetch.mockImplementation((url) => {
      if (String(url).startsWith("/api/vaults")) {
        return new Promise<Response>((resolve) => {
          resolveVaults = resolve;
        });
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    render(wrap(<OnboardingPanel />));

    expect(screen.queryByTestId("greenfield-vault-name-input")).toBeNull();
    expect(screen.getByRole("status")).toBeVisible();

    resolveVaults(
      vaultsResponse([{ name: "reef-acme", has_reef_config: true }]),
    );
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/workspace/reef-acme/issues"),
    );
  });

  it("shows a retryable error without flashing the form", async () => {
    let attempts = 0;
    mockApiFetch.mockImplementation(async (url) => {
      if (String(url).startsWith("/api/vaults")) {
        attempts += 1;
        return attempts === 1
          ? new Response("failed", { status: 500 })
          : vaultsResponse([{ name: "reef-acme", has_reef_config: true }]);
      }
      return new Response("{}", { status: 200 });
    });
    const user = userEvent.setup();

    render(wrap(<OnboardingPanel />));

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByTestId("greenfield-vault-name-input")).toBeNull();

    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/workspace/reef-acme/issues"),
    );
  });

  it("does not render a Connect GitHub token panel (REEF-244)", async () => {
    setupMockApi();
    render(wrap(<OnboardingPanel />));

    expect(await screen.findByTestId("onboarding-panel")).toBeInTheDocument();
    expect(
      screen.queryByText(/Connect GitHub/i, { selector: "summary" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("onboarding-token-input"),
    ).not.toBeInTheDocument();
  });
});
