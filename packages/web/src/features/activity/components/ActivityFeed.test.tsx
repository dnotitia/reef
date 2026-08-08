// fake-indexeddb/auto — ActivityFeed still touches local last_visit_at storage.
import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useActivityStore } from "../stores/useActivityStore";
import type { ActivityFeedItem } from "../types";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const { activityFeedState } = vi.hoisted(() => ({
  activityFeedState: {
    items: [] as ActivityFeedItem[],
  },
}));

vi.mock("../hooks/useActivityFeed", () => ({
  useActivityFeed: () => ({
    items: activityFeedState.items,
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

// The feed gates its manual scan affordance on the workspace AI-scanning switch
// (REEF-313). Default it on so the existing scan-target/refresh assertions hold;
// a test flips it off to exercise the off state.
const { projectConfigState } = vi.hoisted(() => ({
  projectConfigState: { aiScanningEnabled: true },
}));
vi.mock("@/features/settings/hooks/useProjectConfig", () => ({
  useProjectConfig: () => ({
    data: {
      config: {
        project_prefix: "REEF",
        ai_scanning_enabled: projectConfigState.aiScanningEnabled,
      },
    },
  }),
}));

vi.mock("../hooks/useLastVisitAt", () => ({
  useLastVisitAt: () => ({
    lastVisitAt: null,
    isLoading: false,
    updateLastVisitAt: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ vault: "reef-acme" }),
}));

import { ActivityFeed } from "./ActivityFeed";

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

const pendingStatusChange: ActivityFeedItem = {
  id: "status-suggestion-1",
  type: "ai_status_change",
  timestamp: "2026-08-08T00:00:00.000Z",
  issueId: "REEF-001",
  issueTitle: "Existing proposal",
  statusChange: {
    id: "status-suggestion-1",
    kind: "status_change",
    status: "pending",
    repo: "octo/cat",
    fingerprint: "REEF-001|in_progress|octo/cat:pr:1",
    proposal: {
      operation: "update",
      update: {
        issue_id: "REEF-001",
        patch: { status: "in_progress" },
      },
    },
    issue_title: "Existing proposal",
    from_status: "todo",
    rationale: "The activity indicates that this work started.",
    evidence: [{ type: "pr", ref: "1", repo: "octo/cat", actor: "dev" }],
    confidence: 0.9,
    created_at: "2026-08-08T00:00:00.000Z",
    detected_at: "2026-08-08T00:00:00.000Z",
  },
};

describe("ActivityFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityRepoState.monitoredRepos = ["octo/cat"];
    projectConfigState.aiScanningEnabled = true;
    activityFeedState.items = [];
    useActivityStore.setState({ activityTypeFilter: "all" });
  });

  it("renders without crashing with a vault prop", () => {
    render(wrap(<ActivityFeed vault="reef-acme" />));
    expect(
      screen.getByRole("heading", { name: "No suggestions to review" }),
    ).toBeInTheDocument();
  });

  it("renders suggestion filter buttons (All / Draft issues / Status Changes)", () => {
    render(wrap(<ActivityFeed vault="reef-acme" />));
    expect(screen.getByRole("button", { name: /All/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Draft issues/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Status Changes/i }),
    ).toBeInTheDocument();
  });

  it("links to Settings client-side when no monitored repo is configured (REEF-262)", () => {
    activityRepoState.monitoredRepos = [];
    render(wrap(<ActivityFeed vault="reef-acme" />));
    expect(
      screen.getByRole("heading", { name: "Set up a monitored repository" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("activity-empty-state")).toContainElement(
      screen.getByText(
        "Add a monitored repository to start looking for suggestions.",
      ),
    );
    expect(
      screen.getByTestId("activity-scan-target-empty"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("activity-refresh")).toBeDisabled();
    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toHaveAttribute("href", "/workspace/reef-acme/settings");
    expect(link).toHaveAttribute("data-next-link", "true");
  });

  it("keeps pending proposals visible when monitored repositories are removed", () => {
    activityRepoState.monitoredRepos = [];
    activityFeedState.items = [pendingStatusChange];

    render(wrap(<ActivityFeed vault="reef-acme" />));

    expect(screen.getByTestId("activity-item-ai_status_change")).toBeVisible();
    expect(
      screen.queryByTestId("activity-empty-state"),
    ).not.toBeInTheDocument();
  });

  it("uses a passive framed empty state when a monitored repository has no suggestions", () => {
    render(wrap(<ActivityFeed vault="reef-acme" />));

    const emptyState = screen.getByTestId("activity-empty-state");
    expect(
      screen.getByRole("heading", { name: "No suggestions to review" }),
    ).toBeInTheDocument();
    expect(within(emptyState).queryByRole("button")).not.toBeInTheDocument();
    expect(within(emptyState).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByTestId("activity-refresh")).not.toBeDisabled();
  });

  it("shows an outside-frame recovery control for a filtered no-match", async () => {
    activityFeedState.items = [pendingStatusChange];
    useActivityStore.setState({ activityTypeFilter: "ai_draft" });

    render(wrap(<ActivityFeed vault="reef-acme" />));

    expect(
      screen.getByRole("heading", { name: "No matching suggestions" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("activity-clear-filters")).toBeInTheDocument();
    expect(screen.getByTestId("activity-empty-state")).not.toContainElement(
      screen.getByTestId("activity-clear-filters"),
    );
    expect(
      screen.queryByTestId("activity-item-ai_status_change"),
    ).not.toBeInTheDocument();
  });

  it("restores filtered proposals when Clear filters is activated by pointer or keyboard", async () => {
    const user = userEvent.setup();
    activityFeedState.items = [pendingStatusChange];
    useActivityStore.setState({ activityTypeFilter: "ai_draft" });

    const { rerender } = render(wrap(<ActivityFeed vault="reef-acme" />));
    const clearFilters = screen.getByTestId("activity-clear-filters");

    await user.click(clearFilters);
    expect(useActivityStore.getState().activityTypeFilter).toBe("all");
    expect(screen.getByTestId("activity-item-ai_status_change")).toBeVisible();

    useActivityStore.setState({ activityTypeFilter: "ai_draft" });
    rerender(wrap(<ActivityFeed vault="reef-acme" />));
    const keyboardClearFilters = screen.getByTestId("activity-clear-filters");
    keyboardClearFilters.focus();
    await user.keyboard("{Enter}");

    expect(useActivityStore.getState().activityTypeFilter).toBe("all");
    expect(screen.getByTestId("activity-item-ai_status_change")).toBeVisible();
  });

  it("hides the manual scan affordance and shows an off note when AI scanning is disabled (REEF-313)", () => {
    projectConfigState.aiScanningEnabled = false;
    render(wrap(<ActivityFeed vault="reef-acme" />));
    expect(screen.getByTestId("activity-scanning-off")).toBeInTheDocument();
    // The manual refresh button and the scan-target line are both suppressed.
    expect(screen.queryByTestId("activity-refresh")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("activity-scan-target"),
    ).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toHaveAttribute("href", "/workspace/reef-acme/settings");
  });
});
