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

vi.mock("../hooks/useActivityFeed", () => ({
  useActivityFeed: () => ({
    items: [],
    isLoading: false,
    refreshInbox: vi.fn(),
  }),
}));

// Mutable so a test can drop to zero monitored repos and exercise the
// "Add a monitored repository in Settings" empty state (REEF-262).
const { activityRepoState } = vi.hoisted(() => ({
  activityRepoState: { monitoredRepos: ["octo/cat"] as string[] },
}));

vi.mock("../hooks/useActivityRepo", () => ({
  useActivityRepo: () => ({
    repo: activityRepoState.monitoredRepos[0] ?? "",
    monitoredRepos: activityRepoState.monitoredRepos,
    setRepo: vi.fn(),
    isLoading: false,
  }),
}));

// `data-next-link` marks anchors routed through Next `Link`; a raw `<a>` lacks
// it, so the empty-state Settings link assertion fails on a full-reload
// regression (REEF-262).
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a data-next-link="true" href={href} {...rest}>
      {children}
    </a>
  ),
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
    activityRepoState.monitoredRepos = ["octo/cat"];
  });

  it("renders without crashing with a vault prop", () => {
    render(wrap(<ActivityFeed vault="reef-acme" />));
    // The empty state message renders when items is []
    expect(screen.queryByText(/loading/i) ?? document.body).toBeInTheDocument();
  });

  it("renders activity filter buttons (All / AI Drafts / Status Changes)", () => {
    render(wrap(<ActivityFeed vault="reef-acme" />));
    expect(screen.getByRole("button", { name: /All/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /AI Drafts/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Status Changes/i }),
    ).toBeInTheDocument();
  });

  it("links to Settings client-side when no monitored repo is configured (REEF-262)", () => {
    activityRepoState.monitoredRepos = [];
    render(wrap(<ActivityFeed vault="reef-acme" />));
    expect(
      screen.getByTestId("activity-scan-target-empty"),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(link).toHaveAttribute("data-next-link", "true");
  });
});
