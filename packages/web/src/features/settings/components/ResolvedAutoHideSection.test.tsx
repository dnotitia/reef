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
import { ResolvedAutoHideSection } from "./ResolvedAutoHideSection";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function mockConfig() {
  mockApiFetch.mockImplementation(async (url, init) => {
    const input = String(url);
    if (input.startsWith("/api/config") && !init) {
      return new Response(
        JSON.stringify({
          config: {
            project_prefix: "REEF",
            monitored_repos: [],
            authoring_language: null,
            stale_hide_completed_days: 14,
            stale_hide_canceled_days: 3,
          },
        }),
        { status: 200 },
      );
    }
    if (input === "/api/config" && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as {
        patch: {
          stale_hide_completed_days: number;
          stale_hide_canceled_days: number;
        };
      };
      return new Response(
        JSON.stringify({
          config: {
            project_prefix: "REEF",
            monitored_repos: [],
            authoring_language: null,
            ...body.patch,
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${input}`);
  });
}

describe("ResolvedAutoHideSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig();
  });

  it("renders the persisted resolved auto-hide windows", async () => {
    render(wrap(<ResolvedAutoHideSection canEdit />));

    expect(
      await screen.findByLabelText("Hide completed after N days"),
    ).toHaveValue(14);
    expect(screen.getByLabelText("Hide canceled after N days")).toHaveValue(3);
  });

  it("preserves a blank field's current value instead of resetting it to the default", async () => {
    const user = userEvent.setup();
    render(wrap(<ResolvedAutoHideSection canEdit />));

    await user.clear(
      await screen.findByLabelText("Hide canceled after N days"),
    );
    await user.clear(screen.getByLabelText("Hide completed after N days"));
    await user.type(screen.getByLabelText("Hide completed after N days"), "21");
    await user.click(screen.getByTestId("resolved-auto-hide-save"));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/config",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            vault: "reef-acme",
            patch: {
              stale_hide_completed_days: 21,
              stale_hide_canceled_days: 3,
            },
          }),
        }),
      );
    });
  });
});
