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

import { apiFetch } from "@/lib/apiClient";
import { AuthoringLanguageSection } from "./AuthoringLanguageSection";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function mockConfig(authoring_language: string | null) {
  mockApiFetch.mockImplementation(async (url) => {
    if (String(url).startsWith("/api/config")) {
      return new Response(
        JSON.stringify({
          config: {
            project_prefix: "REEF",
            monitored_repos: [],
            authoring_language,
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("AuthoringLanguageSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeVault.current = { vault: "reef-acme", isLoading: false };
  });

  it("renders the picker for editors, showing the persisted language (AC1)", async () => {
    mockConfig("ko");
    render(wrap(<AuthoringLanguageSection canEdit />));

    const trigger = await screen.findByTestId("authoring-language-select");
    // The trigger reflects the saved value's label, so reopening Settings shows
    // the persisted choice.
    expect(trigger).toHaveTextContent("한국어");
    expect(
      screen.queryByTestId("authoring-language-readonly"),
    ).not.toBeInTheDocument();
  });

  it("shows the picker with the unset option when no default is configured", async () => {
    mockConfig(null);
    render(wrap(<AuthoringLanguageSection canEdit />));

    const trigger = await screen.findByTestId("authoring-language-select");
    expect(trigger).toHaveTextContent(/not set/i);
  });

  it("renders read-only for non-writer members (AC4)", async () => {
    mockConfig("ko");
    render(wrap(<AuthoringLanguageSection canEdit={false} />));

    await waitFor(() => {
      expect(
        screen.getByTestId("authoring-language-readonly"),
      ).toHaveTextContent("한국어");
    });
    // No editable control for readers.
    expect(
      screen.queryByTestId("authoring-language-select"),
    ).not.toBeInTheDocument();
  });

  it("shows an em dash read-only value when unset for a reader", async () => {
    mockConfig(null);
    render(wrap(<AuthoringLanguageSection canEdit={false} />));

    await waitFor(() => {
      expect(
        screen.getByTestId("authoring-language-readonly"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("authoring-language-select"),
    ).not.toBeInTheDocument();
  });
});
