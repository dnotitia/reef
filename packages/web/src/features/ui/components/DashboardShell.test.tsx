import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

vi.mock("@/features/preferences/hooks/useThemeSync", () => ({
  useThemeSync: vi.fn(),
}));

const { navigationState, unreadInboxState } = vi.hoisted(() => ({
  navigationState: {
    pathname: "/issues",
  },
  unreadInboxState: {
    count: 0,
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
