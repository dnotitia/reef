import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    ...activeVault.current,
    refetch: () => Promise.resolve(),
  }),
}));

// Deployment-managed GitHub App availability (REEF-244).
const appState = vi.hoisted(() => ({
  current: {
    isAvailable: true,
    isLoading: false,
    appId: null as string | null,
  },
}));
vi.mock("@/features/settings/hooks/useGithubAppAvailable", () => ({
  useGithubAppAvailable: () => appState.current,
}));

import { apiFetch } from "@/lib/apiClient";
import { RepoPickerSection } from "./RepoPickerSection";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("RepoPickerSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeVault.current = { vault: "reef-acme", isLoading: false };
    appState.current = { isAvailable: true, isLoading: false, appId: "123456" };
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/vaults")) {
        return new Response(
          JSON.stringify({
            vaults: [
              {
                name: "reef-acme",
                description: null,
                status: "active",
                role: "owner",
                created_at: null,
                has_reef_config: true,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/config")) {
        return new Response(
          JSON.stringify({
            config: { project_prefix: "REEF", monitored_repos: [] },
          }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/repos")) {
        return new Response(JSON.stringify({ repos: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
  });

  it("calls /api/config for the active vault", async () => {
    render(wrap(<RepoPickerSection />));
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith("/api/config?vault=reef-acme"),
    );
  });

  it("no longer renders the workspace picker (moved to ActiveWorkspaceSection)", async () => {
    // REEF-150 AC5: the vault-selection responsibility moved out; this section
    // just edits the monitored repos of whatever vault is already active.
    render(wrap(<RepoPickerSection />));
    expect(
      await screen.findByTestId("repo-picker-section"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("active-vault-trigger"),
    ).not.toBeInTheDocument();
  });

  it("renders monitored repos read-only (no selector) when the viewer cannot edit", async () => {
    render(wrap(<RepoPickerSection canEdit={false} />));
    expect(
      await screen.findByTestId("monitored-repos-readonly-empty"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("monitored-repos-trigger"),
    ).not.toBeInTheDocument();
  });

  it("shows a loading skeleton (not a false empty) while config is pending in read-only mode", async () => {
    // Config fetch hangs → configQuery stays pending; the read path should
    // not render "No repositories are being monitored" against an unloaded list.
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/vaults")) {
        return new Response(
          JSON.stringify({
            vaults: [
              {
                name: "reef-acme",
                description: null,
                status: "active",
                role: "reader",
                created_at: null,
                has_reef_config: true,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/config")) {
        return new Promise<Response>(() => {}); // does not resolves
      }
      return new Response(JSON.stringify({ repos: [] }), { status: 200 });
    });

    render(wrap(<RepoPickerSection canEdit={false} />));
    expect(
      await screen.findByTestId("monitored-repos-readonly-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("monitored-repos-readonly-empty"),
    ).not.toBeInTheDocument();
  });

  it("shows a loading skeleton (not a false empty) while the active vault is still hydrating", async () => {
    // Dexie hydration: useActiveVault returns vault="" with isLoading=true. The
    // read path should not fall through to the empty state in that window.
    activeVault.current = { vault: "", isLoading: true };
    render(wrap(<RepoPickerSection canEdit={false} />));
    expect(
      await screen.findByTestId("monitored-repos-readonly-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("monitored-repos-readonly-empty"),
    ).not.toBeInTheDocument();
  });

  it("shows the GitHub App hint and issues no /api/repos request when unconfigured (REEF-244)", async () => {
    // No deployment App -> the selector renders the deployment-state hint
    // instead of a forever skeleton, and useRepos stays disabled so no
    // unavailable-bound request is sent.
    appState.current = { isAvailable: false, isLoading: false, appId: null };
    render(wrap(<RepoPickerSection />));

    expect(
      await screen.findByTestId("monitored-repos-load-error"),
    ).toBeInTheDocument();
    // Config still loads (it's vault-scoped, not GitHub-bound)...
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith("/api/config?vault=reef-acme"),
    );
    // ...but /api/repos is not hit.
    expect(
      mockApiFetch.mock.calls.some(([url]) =>
        String(url).startsWith("/api/repos"),
      ),
    ).toBe(false);
  });

  it("lists repos when the server GitHub App is available (REEF-244)", async () => {
    // The deployment-managed App serves the list: the selector loads available
    // repos and shows no GitHub-unavailable hint.
    appState.current = { isAvailable: true, isLoading: false, appId: "123456" };
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/config")) {
        return new Response(
          JSON.stringify({
            config: { project_prefix: "REEF", monitored_repos: [] },
          }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/repos")) {
        return new Response(
          JSON.stringify({ repos: [{ full_name: "octo/reef", id: 1001 }] }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });

    render(wrap(<RepoPickerSection />));

    // The selector trigger renders (not the connect hint), and /api/repos was hit.
    expect(
      await screen.findByTestId("monitored-repos-trigger"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("monitored-repos-load-error"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        mockApiFetch.mock.calls.some(([url]) =>
          String(url).startsWith("/api/repos"),
        ),
      ).toBe(true),
    );
  });
});
