// fake-indexeddb/auto — OnboardingPanel reads/writes vault + token via Dexie.
import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/apiClient";
import { getActiveVault, setActiveVault } from "@/lib/storage/config";
import { getGitHubToken, setGitHubToken } from "@/lib/storage/credentials";
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
    window.localStorage.clear();
    await db.config.clear();
    await db.credentials.clear();
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

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/issues"));
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
    // The repo picker fetches once a GitHub token is configured (REEF-159);
    // seed one so the selector is populated.
    await setGitHubToken("ghp_seeded");
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
    await user.type(
      screen.getByTestId("greenfield-vault-name-input"),
      "reef-new",
    );
    await user.click(screen.getByTestId("greenfield-create-btn"));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/issues"));
    const call = postVaultCall();
    expect(JSON.parse(String(call?.[1]?.body)).monitored_repos).toEqual([
      { github_id: 111, owner: "octo", name: "cat" },
    ]);
  });

  it("keeps existing reef workspace selection as the secondary flow", async () => {
    setupMockApi({
      vaults: [
        { name: "reef-acme", has_reef_config: true },
        { name: "raw-vault", has_reef_config: false },
      ],
    });
    const user = userEvent.setup();

    render(wrap(<OnboardingPanel />));

    await user.click(
      await screen.findByText(/Use an existing reef workspace/i),
    );
    await user.click(await screen.findByTestId("active-vault-trigger"));

    expect(
      await screen.findByTestId("active-vault-option-reef-acme"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("active-vault-option-raw-vault"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId("active-vault-option-reef-acme"));
    await user.click(await screen.findByTestId("onboarding-continue-btn"));

    expect(mockPush).toHaveBeenCalledWith("/issues");
  });

  it("shows an empty existing-workspace state when no vault has reef config", async () => {
    setupMockApi({
      vaults: [{ name: "raw-vault", has_reef_config: false }],
    });
    const user = userEvent.setup();

    render(wrap(<OnboardingPanel />));

    await user.click(
      await screen.findByText(/Use an existing reef workspace/i),
    );
    expect(
      await screen.findByTestId("onboarding-empty-state"),
    ).toHaveTextContent(/No existing reef workspaces found/i);
  });

  it("Continue stays disabled when the saved activeVault is not in the filtered list", async () => {
    await setActiveVault("ghost-vault");
    setupMockApi({ vaults: [{ name: "reef-acme", has_reef_config: true }] });
    const user = userEvent.setup();

    render(wrap(<OnboardingPanel />));

    await user.click(
      await screen.findByText(/Use an existing reef workspace/i),
    );
    const btn = await screen.findByTestId("onboarding-continue-btn");
    expect(btn).toBeDisabled();
  });

  it("opens the repo picker when a GitHub token is saved, and issues no /api/repos call until then (REEF-159)", async () => {
    let repoCalls = 0;
    mockApiFetch.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.startsWith("/api/vaults") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            name: "reef-new",
            config: { project_prefix: "REEF", monitored_repos: [] },
          }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/vaults")) return vaultsResponse([]);
      if (u.startsWith("/api/repos")) {
        repoCalls++;
        return new Response(
          JSON.stringify({ repos: [{ full_name: "octo/cat", id: 111 }] }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    // GitHubTokenInput verifies the PAT via a raw fetch("/api/repos") before
    // persisting; that path is the global fetch, not apiFetch, so it does not
    // touch repoCalls.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ repos: [] }), { status: 200 }),
        ),
    );
    const user = userEvent.setup();

    render(wrap(<OnboardingPanel />));

    // Unconfigured: the picker shows the connect hint and the gate suppresses
    // the GitHub call entirely — no 401 can accumulate.
    expect(
      await screen.findByTestId("greenfield-monitored-repos-load-error"),
    ).toBeInTheDocument();
    expect(repoCalls).toBe(0);

    await user.click(
      await screen.findByText(/Connect GitHub/i, { selector: "summary" }),
    );
    await user.type(
      await screen.findByTestId("onboarding-token-input"),
      "ghp_valid",
    );
    await user.click(screen.getByTestId("onboarding-save-token-btn"));

    // Saving the token flips the gate (via AUTH_CHANGED_EVENT), so the now-enabled
    // query fetches and the picker becomes available without a manual refresh.
    expect(
      await screen.findByTestId("greenfield-monitored-repos-trigger"),
    ).toBeInTheDocument();
    await waitFor(() => expect(repoCalls).toBeGreaterThanOrEqual(1));
    expect(await getGitHubToken()).toBe("ghp_valid");
  });
});
