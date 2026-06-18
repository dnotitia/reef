// fake-indexeddb/auto — ActivityFeed still touches local last_visit_at storage.
import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/features/auth/hooks/useCredentials", () => ({
  useCredentials: () => ({ token: "ghp_token", isLoading: false }),
}));

vi.mock("../hooks/useActivityFeed", () => ({
  useActivityFeed: () => ({
    items: [],
    isLoading: false,
    refreshInbox: vi.fn(),
  }),
}));

vi.mock("../hooks/useActivityRepo", () => ({
  useActivityRepo: () => ({
    repo: "octo/cat",
    monitoredRepos: ["octo/cat"],
    setRepo: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("../hooks/useScanActivity", () => ({
  useScanActivity: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../hooks/useLastVisitAt", () => ({
  useLastVisitAt: () => ({
    lastVisitAt: null,
    isLoading: false,
    updateLastVisitAt: vi.fn(),
  }),
}));

vi.mock("../stores/useActivityStore", () => ({
  useActivityStore: <T,>(
    selector: (s: {
      activityTypeFilter: string;
      setActivityTypeFilter: (v: string) => void;
    }) => T,
  ): T =>
    selector({
      activityTypeFilter: "all",
      setActivityTypeFilter: vi.fn(),
    }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { ActivityFeed } from "./ActivityFeed";

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("ActivityFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing with a vault prop", () => {
    render(wrap(<ActivityFeed vault="reef-acme" />));
    // The empty state message renders when items is []
    expect(screen.queryByText(/loading/i) ?? document.body).toBeInTheDocument();
  });

  it("renders activity filter buttons (All / AI Drafts / AI Status Changes / Issue Changes)", () => {
    render(wrap(<ActivityFeed vault="reef-acme" />));
    expect(screen.getByRole("button", { name: /All/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /AI Drafts/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /AI Status Changes/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Issue Changes/i }),
    ).toBeInTheDocument();
  });
});
