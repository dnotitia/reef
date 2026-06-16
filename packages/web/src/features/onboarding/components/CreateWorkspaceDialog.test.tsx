// fake-indexeddb/auto — the create form sets the new vault active via Dexie.
import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
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

import { useViewStore } from "@/features/ui/stores/useViewStore";
import { apiFetch } from "@/lib/apiClient";
import { db } from "@/lib/storage/db";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function setupMockApi() {
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
    if (u.startsWith("/api/vaults")) {
      return new Response(JSON.stringify({ vaults: [] }), { status: 200 });
    }
    if (u.startsWith("/api/repos")) {
      return new Response(JSON.stringify({ repos: [] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
}

describe("CreateWorkspaceDialog", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockPush.mockReset();
    window.localStorage.clear();
    await db.config.clear();
    useViewStore.setState({ createWorkspaceDialogOpen: false });
  });

  afterEach(() => {
    useViewStore.setState({ createWorkspaceDialogOpen: false });
    window.localStorage.clear();
  });

  it("stays hidden until the store flag opens it", () => {
    setupMockApi();
    render(wrap(<CreateWorkspaceDialog />));
    expect(
      screen.queryByTestId("create-workspace-dialog"),
    ).not.toBeInTheDocument();
  });

  it("opens from the store, creates a workspace, then closes (AC4)", async () => {
    setupMockApi();
    const user = userEvent.setup();

    render(wrap(<CreateWorkspaceDialog />));
    act(() => {
      useViewStore.getState().openCreateWorkspaceDialog();
    });

    expect(
      await screen.findByTestId("create-workspace-dialog"),
    ).toBeInTheDocument();

    await user.type(
      screen.getByTestId("create-workspace-vault-name-input"),
      "reef-new",
    );
    await user.click(screen.getByTestId("create-workspace-create-btn"));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/issues"));
    await waitFor(() =>
      expect(useViewStore.getState().createWorkspaceDialogOpen).toBe(false),
    );
  });

  it("closes via Cancel without creating anything", async () => {
    setupMockApi();
    const user = userEvent.setup();

    render(wrap(<CreateWorkspaceDialog />));
    act(() => {
      useViewStore.getState().openCreateWorkspaceDialog();
    });

    await user.click(await screen.findByTestId("create-workspace-cancel-btn"));

    await waitFor(() =>
      expect(useViewStore.getState().createWorkspaceDialogOpen).toBe(false),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
