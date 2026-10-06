// fake-indexeddb/auto - CreateWorkspaceForm stores the active vault via Dexie.
import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
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
import { getActiveVault } from "@/lib/storage/config";
import { db } from "@/lib/storage/db";
import { DEFAULT_CONFIG } from "@reef/core";
import { OnboardingPanel } from "./OnboardingPanel";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function emptyResumeState() {
  return { status: "empty" as const, retry: vi.fn() };
}

interface MockApiOptions {
  repos?: ReadonlyArray<{ full_name: string; id: number }>;
  postStatus?: number;
  postBody?: Record<string, unknown>;
}

function setupMockApi({
  repos = [],
  postStatus = 200,
  postBody = {
    name: "reef-new",
    config: DEFAULT_CONFIG,
  },
}: MockApiOptions = {}) {
  mockApiFetch.mockImplementation(async (url, init) => {
    const u = String(url);
    if (u === "/api/vaults" && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          vault_id: "33333333-3333-4333-8333-333333333333",
          ...postBody,
        }),
        { status: postStatus },
      );
    }
    if (u.endsWith("/installation") && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          installation_status: "ready",
          command_status: "accepted",
          replayed: false,
        }),
        { status: 200 },
      );
    }
    if (u === "/api/config" && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { patch: unknown };
      return new Response(JSON.stringify({ config: body.patch }), {
        status: 200,
      });
    }
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

    render(wrap(<OnboardingPanel resumeState={emptyResumeState()} />));

    expect(await screen.findByTestId("onboarding-panel")).toBeInTheDocument();
    expect(screen.getByTestId("greenfield-vault-name-input")).toBeVisible();
    expect(screen.getByTestId("greenfield-project-prefix-input")).toHaveValue(
      "REEF",
    );
  });

  it("creates a new workspace, stores it as active, and routes to /issues", async () => {
    setupMockApi();
    const user = userEvent.setup();

    render(wrap(<OnboardingPanel resumeState={emptyResumeState()} />));

    await user.type(
      await screen.findByTestId("greenfield-vault-name-input"),
      "reef-new",
    );
    await user.click(screen.getByTestId("greenfield-create-btn"));
    expect(await screen.findByTestId("greenfield-approval-step")).toBeVisible();
    expect(mockPush).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("installation-reef-new-approve"));

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
          ...DEFAULT_CONFIG,
          project_prefix: "REEF",
          monitored_repos: [{ github_id: 111, owner: "octo", name: "cat" }],
        },
      },
    });
    const user = userEvent.setup();

    render(wrap(<OnboardingPanel resumeState={emptyResumeState()} />));

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
    expect(await screen.findByTestId("greenfield-approval-step")).toBeVisible();
    await user.click(screen.getByTestId("installation-reef-new-approve"));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/workspace/reef-new/issues"),
    );
    const call = postVaultCall();
    expect(JSON.parse(String(call?.[1]?.body)).monitored_repos).toEqual([
      { github_id: 111, owner: "octo", name: "cat" },
    ]);
  });

  it("renders the parent-provided loading state without the create form", () => {
    render(
      wrap(
        <OnboardingPanel resumeState={{ status: "pending", retry: vi.fn() }} />,
      ),
    );

    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.queryByTestId("greenfield-vault-name-input")).toBeNull();
    expect(mockApiFetch).not.toHaveBeenCalledWith("/api/vaults");
  });

  it("delegates retryable workspace errors to the parent", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(wrap(<OnboardingPanel resumeState={{ status: "error", retry }} />));

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByTestId("greenfield-vault-name-input")).toBeNull();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("does not render a Connect GitHub token panel (REEF-244)", async () => {
    setupMockApi();
    render(wrap(<OnboardingPanel resumeState={emptyResumeState()} />));

    expect(await screen.findByTestId("onboarding-panel")).toBeInTheDocument();
    expect(
      screen.queryByText(/Connect GitHub/i, { selector: "summary" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("onboarding-token-input"),
    ).not.toBeInTheDocument();
  });
});
