import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: "reef-acme",
    isLoading: false,
    refetch: () => Promise.resolve(),
  }),
}));

import { apiFetch } from "@/lib/apiClient";
import { ActivityScanningSection } from "./ActivityScanningSection";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

/** GET returns scanning off (the default); PATCH echoes the merged patch. */
function mockConfig(initialEnabled = false) {
  mockApiFetch.mockImplementation(async (url, init) => {
    const input = String(url);
    if (input.startsWith("/api/config") && !init) {
      return new Response(
        JSON.stringify({
          config: {
            project_prefix: "REEF",
            monitored_repos: [],
            authoring_language: null,
            stale_hide_completed_days: 28,
            stale_hide_canceled_days: 7,
            ai_scanning_enabled: initialEnabled,
          },
        }),
        { status: 200 },
      );
    }
    if (input === "/api/config" && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as {
        patch: { ai_scanning_enabled?: boolean };
      };
      return new Response(
        JSON.stringify({
          config: {
            project_prefix: "REEF",
            monitored_repos: [],
            authoring_language: null,
            stale_hide_completed_days: 28,
            stale_hide_canceled_days: 7,
            ai_scanning_enabled: false,
            ...body.patch,
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${input}`);
  });
}

describe("ActivityScanningSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig();
  });

  it("renders a switch reflecting the persisted off state", async () => {
    render(wrap(<ActivityScanningSection canEdit />));

    const toggle = await screen.findByRole("switch", {
      name: "Toggle AI activity scanning",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("activity-scanning-state")).toHaveTextContent(
      "Off",
    );
  });

  it("PATCHes ai_scanning_enabled when toggled on (REEF-313)", async () => {
    const user = userEvent.setup();
    render(wrap(<ActivityScanningSection canEdit />));

    await user.click(
      await screen.findByRole("switch", {
        name: "Toggle AI activity scanning",
      }),
    );

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/config",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            vault: "reef-acme",
            patch: { ai_scanning_enabled: true },
          }),
        }),
      );
    });
  });

  it("shows a read-only state for non-admin viewers (no switch)", async () => {
    render(wrap(<ActivityScanningSection canEdit={false} />));

    expect(
      await screen.findByTestId("activity-scanning-readonly"),
    ).toHaveTextContent("Off");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
