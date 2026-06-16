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

// GitHub token gate (REEF-159). Default to "token present" so the existing
// config/selector tests keep their behavior; the unconfigured test flips it.
const tokenState = vi.hoisted(() => ({
  current: { hasToken: true, isLoading: false },
}));
vi.mock("@/features/settings/hooks/useHasGithubToken", () => ({
  useHasGithubToken: () => tokenState.current,
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
    tokenState.current = { hasToken: true, isLoading: false };
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

  it("shows the connect-GitHub hint and issues no /api/repos request when unconfigured (REEF-159)", async () => {
    // No token → the selector renders the connect hint instead of a forever
    // skeleton, and useRepos stays disabled so no 401-bound request is sent.
    tokenState.current = { hasToken: false, isLoading: false };
    render(wrap(<RepoPickerSection />));

    expect(
      await screen.findByTestId("monitored-repos-load-error"),
    ).toBeInTheDocument();
    // Config still loads (it's vault-scoped, not GitHub-bound)...
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith("/api/config?vault=reef-acme"),
    );
    // ...but /api/repos is does not hit.
    expect(
      mockApiFetch.mock.calls.some(([url]) =>
        String(url).startsWith("/api/repos"),
      ),
    ).toBe(false);
  });
});
