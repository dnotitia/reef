import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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
  // SidebarWorkspace (in the footer) switches the active vault from the same
  // module, so the shell now needs this export too.
  useSetActiveVault: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));

vi.mock("@/features/activity/hooks/useActivityRepo", () => ({
  useActivityRepo: () => ({
    repo: "octo/cat",
    monitoredRepos: ["octo/cat"],
    setRepo: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("@/features/activity/hooks/useScanActivity", () => ({
  useScanActivity: () => ({ mutate: vi.fn(), isPending: false }),
  useScanAutoTrigger: vi.fn(),
}));

vi.mock("@/features/activity/hooks/useUnreadInboxCount", () => ({
  useUnreadInboxCount: () => unreadInboxState.count,
  UNREAD_INBOX_QUERY_KEY: ["unread-inbox"],
}));

// The My Work sidebar badge (REEF-204) reads its overdue/due-soon counts from
// this hook; mock it so each test drives the badge tone/visibility directly.
vi.mock("@/features/my-work/hooks/useMyWorkAttention", () => ({
  useMyWorkAttention: () => myWorkAttentionState,
}));

// The Settings skill-drift badge (REEF-257) reads workspace skill status from
// this hook. DashboardShell only consumes `.data?.up_to_date`, so a partial
// query-result shape is enough to drive the badge directly.
vi.mock("@/features/settings/hooks/useWorkspaceSkillStatus", () => ({
  useWorkspaceSkillStatus: () => skillStatusState,
}));

vi.mock("@/features/preferences/hooks/useThemeSync", () => ({
  useThemeSync: vi.fn(),
}));

const {
  navigationState,
  unreadInboxState,
  myWorkAttentionState,
  skillStatusState,
} = vi.hoisted(() => ({
  navigationState: {
    pathname: "/issues",
  },
  unreadInboxState: {
    count: 0,
  },
  myWorkAttentionState: {
    attention: 0,
    overdue: 0,
    dueSoon: 0,
  },
  skillStatusState: {
    data: undefined as { up_to_date: boolean } | undefined,
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { useViewStore } from "../stores/useViewStore";
import { DashboardShell } from "./DashboardShell";

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("DashboardShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationState.pathname = "/issues";
    unreadInboxState.count = 0;
    myWorkAttentionState.attention = 0;
    myWorkAttentionState.overdue = 0;
    myWorkAttentionState.dueSoon = 0;
    skillStatusState.data = undefined;
    useViewStore.setState({
      sidebarCollapsed: false,
      newIssueDialogOpen: false,
    });
  });

  it("renders the expanded sidebar brand lockup", () => {
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    expect(screen.getByTestId("sidebar-brand-mark")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-brand-name")).toHaveTextContent("reef");
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument();
  });

  it("shows only the brand mark in the collapsed sidebar header", () => {
    useViewStore.setState({ sidebarCollapsed: true });

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    expect(screen.getByTestId("sidebar-brand-mark")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-brand-name")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
  });

  it("renders the navigation links (Issues, Planning, Activity, Reports, Settings)", () => {
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    expect(screen.getByRole("link", { name: "Issues" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Planning" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reports" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("places My Work right after Issues in the nav (REEF-204)", () => {
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels[0]).toBe("Issues");
    expect(labels[1]).toBe("My Work");
  });

  it("shows the My Work badge in destructive tone when work is overdue (REEF-204)", () => {
    myWorkAttentionState.attention = 12;
    myWorkAttentionState.overdue = 4;
    myWorkAttentionState.dueSoon = 8;
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    const badge = screen.getByTestId("my-work-attention-badge");
    // overdue + due-soon, capped past 9.
    expect(badge).toHaveTextContent("9+");
    expect(badge).toHaveClass("bg-destructive");
    expect(badge).toHaveAccessibleName("4 overdue, 8 due soon");
  });

  it("shows the My Work badge in the orange tone when only due-soon (REEF-204)", () => {
    myWorkAttentionState.attention = 3;
    myWorkAttentionState.overdue = 0;
    myWorkAttentionState.dueSoon = 3;
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    const badge = screen.getByTestId("my-work-attention-badge");
    expect(badge).toHaveTextContent("3");
    expect(badge).toHaveClass("bg-priority-high");
    expect(badge).toHaveAccessibleName("3 due soon");
  });

  it("hides the My Work badge when nothing needs attention (REEF-204)", () => {
    myWorkAttentionState.attention = 0;
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    expect(
      screen.queryByTestId("my-work-attention-badge"),
    ).not.toBeInTheDocument();
  });

  it("hides the My Work badge while on /my-work (the page owns the count) (REEF-204)", () => {
    navigationState.pathname = "/my-work";
    myWorkAttentionState.attention = 2;
    myWorkAttentionState.overdue = 1;
    myWorkAttentionState.dueSoon = 1;
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    expect(
      screen.queryByTestId("my-work-attention-badge"),
    ).not.toBeInTheDocument();
  });

  it("reduces the My Work badge to a tinted dot when collapsed (REEF-204)", () => {
    useViewStore.setState({ sidebarCollapsed: true });
    myWorkAttentionState.attention = 2;
    myWorkAttentionState.overdue = 1;
    myWorkAttentionState.dueSoon = 1;
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    const dot = screen.getByTestId("my-work-attention-dot");
    expect(dot).toBeVisible();
    expect(dot).toHaveClass("bg-destructive");
    // The full count is still announced even though a dot shows.
    expect(dot).toHaveAccessibleName("1 overdue, 1 due soon");
  });

  it("renders visible navigation icons when the sidebar is collapsed", () => {
    useViewStore.setState({ sidebarCollapsed: true });

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    expect(screen.getByRole("link", { name: "Issues" })).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-icon-issues")).toBeVisible();
    expect(screen.getByTestId("sidebar-nav-icon-planning")).toBeVisible();
    expect(screen.getByTestId("sidebar-nav-icon-activity")).toBeVisible();
    expect(screen.getByTestId("sidebar-nav-icon-reports")).toBeVisible();
    expect(screen.getByTestId("sidebar-nav-icon-settings")).toBeVisible();
  });

  it("keeps the collapsed Activity unread dot visible", () => {
    useViewStore.setState({ sidebarCollapsed: true });
    unreadInboxState.count = 3;

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    expect(screen.getByTestId("activity-unread-dot")).toBeVisible();
  });

  it("shows the Settings skill-update dot when the active workspace skill is outdated (REEF-257)", () => {
    skillStatusState.data = { up_to_date: false };
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    const badge = screen.getByTestId("workspace-skill-badge");
    expect(badge).toBeVisible();
    // Orange (warn) advisory tone, never the destructive red reserved for My
    // Work's missed commitments.
    expect(badge).toHaveClass("bg-priority-high");
    expect(badge).toHaveAccessibleName(
      "Workspace instructions update available",
    );
    // It is a count-less dot, not a numeric pill — the label is the only signal.
    expect(badge).toBeEmptyDOMElement();
  });

  it("hides the Settings skill-update dot when the workspace skill is up to date (REEF-257 AC3)", () => {
    skillStatusState.data = { up_to_date: true };
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    expect(
      screen.queryByTestId("workspace-skill-badge"),
    ).not.toBeInTheDocument();
  });

  it("hides the Settings skill-update dot while the status is indeterminate (REEF-257 AC3)", () => {
    // Loading, errored, or a vault-less shell all leave `data` undefined.
    skillStatusState.data = undefined;
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    expect(
      screen.queryByTestId("workspace-skill-badge"),
    ).not.toBeInTheDocument();
  });

  it("hides the Settings skill-update dot while on /settings — the page owns the drift (REEF-257)", () => {
    navigationState.pathname = "/settings/workspace";
    skillStatusState.data = { up_to_date: false };
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    expect(
      screen.queryByTestId("workspace-skill-badge"),
    ).not.toBeInTheDocument();
  });

  it("reduces the Settings skill-update badge to a dot when collapsed (REEF-257)", () => {
    useViewStore.setState({ sidebarCollapsed: true });
    skillStatusState.data = { up_to_date: false };
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    const dot = screen.getByTestId("workspace-skill-dot");
    expect(dot).toBeVisible();
    expect(dot).toHaveClass("bg-priority-high");
    expect(dot).toHaveAccessibleName("Workspace instructions update available");
  });

  it("removes the Settings dot once the workspace skill is updated (REEF-257 AC2)", () => {
    skillStatusState.data = { up_to_date: false };
    const { rerender } = render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    expect(screen.getByTestId("workspace-skill-badge")).toBeVisible();
    // Applying the update primes the shared ["vault-skill", vault] cache to
    // up_to_date; the badge rides that same query, so it clears with no extra
    // wiring.
    skillStatusState.data = { up_to_date: true };
    rerender(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    expect(
      screen.queryByTestId("workspace-skill-badge"),
    ).not.toBeInTheDocument();
  });

  it("keeps Issues active on the /issues/[id] detail route", () => {
    navigationState.pathname = "/issues/REEF-001";
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    expect(screen.getByRole("link", { name: "Issues" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps Settings active across the scope tabs (/settings/workspace) (REEF-183)", () => {
    navigationState.pathname = "/settings/workspace";
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders children inside the layout", () => {
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div data-testid="child-content">hello</div>
        </DashboardShell>,
      ),
    );
    expect(screen.getByTestId("child-content")).toHaveTextContent("hello");
  });
});
