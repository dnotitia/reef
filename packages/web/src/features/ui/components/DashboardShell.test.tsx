import { useGlobalSearchStore } from "@/features/search/stores/useGlobalSearchStore";
import { useShortcutsStore } from "@/features/shortcuts/stores/useShortcutsStore";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/features/activity/hooks/usePendingSuggestionsCount", () => ({
  usePendingSuggestionsCount: () => pendingSuggestionsState.count,
}));

vi.mock("@/features/inbox/hooks/useInboxNotifications", () => ({
  useUnreadNotificationCount: () => unreadNotificationState.count,
}));

// The My Work sidebar badge (REEF-204) reads its overdue/due-soon counts from
// this hook; mock it so each test drives the badge tone/visibility directly.
vi.mock("@/features/my-work/hooks/useMyWorkAttention", () => ({
  useMyWorkAttention: () => myWorkAttentionState,
}));

// The Settings skill-drift badge (REEF-257) reads workspace skill status from
// this hook. DashboardShell consumes `.data?.up_to_date`, so a partial
// query-result shape is enough to drive the badge directly.
vi.mock("@/features/settings/hooks/useWorkspaceSkillStatus", () => ({
  useWorkspaceSkillStatus: () => skillStatusState,
}));

// The locale sync hook consumes next-intl + next/navigation, which this shell
// test does not provide. Its reconcile behavior is covered by its own tests
// and the i18n e2e spec.
vi.mock("@/features/preferences/hooks/useLocaleSync", () => ({
  useLocaleSync: vi.fn(),
}));

const {
  navigationState,
  pendingSuggestionsState,
  unreadNotificationState,
  myWorkAttentionState,
  skillStatusState,
} = vi.hoisted(() => ({
  navigationState: {
    pathname: "/workspace/reef-acme/issues",
    push: vi.fn(),
  },
  pendingSuggestionsState: {
    count: 0,
  },
  unreadNotificationState: {
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
  useRouter: () => ({ push: navigationState.push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { useViewStore } from "../stores/useViewStore";
import { DashboardShell } from "./DashboardShell";

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <IntlTestProvider>{ui}</IntlTestProvider>
    </QueryClientProvider>
  );
}

describe("DashboardShell", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(
    window.navigator,
    "platform",
  );
  const originalUserAgent = Object.getOwnPropertyDescriptor(
    window.navigator,
    "userAgent",
  );

  function mockNavigatorPlatform({
    platform,
    userAgent,
  }: {
    platform: string;
    userAgent: string;
  }) {
    Object.defineProperty(window.navigator, "userAgent", {
      value: userAgent,
      configurable: true,
    });
    Object.defineProperty(window.navigator, "platform", {
      value: platform,
      configurable: true,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    navigationState.pathname = "/workspace/reef-acme/issues";
    pendingSuggestionsState.count = 0;
    unreadNotificationState.count = 0;
    myWorkAttentionState.attention = 0;
    myWorkAttentionState.overdue = 0;
    myWorkAttentionState.dueSoon = 0;
    skillStatusState.data = undefined;
    useViewStore.setState({
      sidebarCollapsed: false,
      newIssueDialogOpen: false,
      newIssueDialogContext: null,
    });
    useGlobalSearchStore.setState({ isOpen: false });
    useShortcutsStore.setState({ isOpen: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalPlatform) {
      Object.defineProperty(window.navigator, "platform", originalPlatform);
    }
    if (originalUserAgent) {
      Object.defineProperty(window.navigator, "userAgent", originalUserAgent);
    }
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

  it("collapses the sidebar on narrow viewports to keep the content column usable", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    expect(screen.getByLabelText("Sidebar")).toHaveClass("w-14");
    expect(screen.queryByTestId("sidebar-brand-name")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-icon-issues")).toBeVisible();
  });

  it("renders the navigation links (Issues, Planning, Suggestions, Reports, Settings)", () => {
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );
    expect(screen.getByRole("link", { name: "Issues" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Planning" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Suggestions" })).toHaveAttribute(
      "href",
      "/workspace/reef-acme/suggestions",
    );
    expect(screen.getByRole("link", { name: "Reports" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("shows the capped Inbox badge with the 100-or-more accessible label", () => {
    unreadNotificationState.count = 100;
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    const badge = screen.getByTestId("inbox-unread-badge");
    expect(badge).toHaveTextContent("9+");
    expect(badge).toHaveAccessibleName("100 or more unread notifications");
    expect(
      screen.getByRole("link", {
        name: "Inbox 100 or more unread notifications",
      }),
    ).toBeInTheDocument();
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
    navigationState.pathname = "/workspace/reef-acme/my-work";
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
    expect(screen.getByTestId("sidebar-nav-icon-suggestions")).toBeVisible();
    expect(screen.getByTestId("sidebar-nav-icon-reports")).toBeVisible();
    expect(screen.getByTestId("sidebar-nav-icon-settings")).toBeVisible();
  });

  it("opens keyboard shortcuts from the sidebar footer utility button (REEF-170)", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    const utility = screen.getByTestId("sidebar-footer-shortcuts");
    const shortcuts = within(utility).getByTestId("sidebar-shortcuts-trigger");
    const workspace = screen.getByTestId("sidebar-workspace");
    const account = screen.getByTestId("sidebar-account");

    expect(utility).toHaveClass("py-1");
    expect(shortcuts).toHaveClass(
      "h-7",
      "w-full",
      "justify-between",
      "text-[12px]",
      "text-muted-foreground/80",
    );
    expect(utility.compareDocumentPosition(workspace)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(workspace.compareDocumentPosition(account)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await user.click(
      screen.getByRole("button", { name: "Keyboard shortcuts" }),
    );

    expect(screen.getByTestId("keyboard-shortcuts-dialog")).toBeVisible();
  });

  it("routes Ctrl+K through the shell's single shortcut dispatcher", () => {
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("global-search-input")).toBeVisible();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByTestId("global-search-input")).not.toBeInTheDocument();
  });

  it("opens the new issue dialog only on the browser-safe shortcut", () => {
    mockNavigatorPlatform({
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    });

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    fireEvent.keyDown(window, { key: "N", ctrlKey: true });
    expect(useViewStore.getState().newIssueDialogOpen).toBe(false);

    fireEvent.keyDown(window, {
      key: "I",
      code: "KeyI",
      ctrlKey: true,
    });
    expect(useViewStore.getState().newIssueDialogOpen).toBe(true);
  });

  it("labels the new issue shortcut with the active platform chord", async () => {
    mockNavigatorPlatform({
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    });

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    expect(
      await screen.findByRole("button", { name: "New issue (Ctrl+I)" }),
    ).toHaveAttribute("title", "New issue (Ctrl+I)");
  });

  it("labels the Firefox new issue shortcut with the browser-safe fallback", async () => {
    mockNavigatorPlatform({
      platform: "Win32",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Firefox/147.0",
    });

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    expect(
      await screen.findByRole("button", { name: "New issue (Ctrl+Alt+N)" }),
    ).toHaveAttribute("title", "New issue (Ctrl+Alt+N)");
  });

  it("opens the new issue dialog on the advertised macOS issue shortcut", () => {
    mockNavigatorPlatform({
      platform: "MacIntel",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    });

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    fireEvent.keyDown(window, {
      key: "I",
      code: "KeyI",
      metaKey: true,
    });
    expect(useViewStore.getState().newIssueDialogOpen).toBe(true);
  });

  it("opens the new issue dialog on the advertised Firefox fallback", () => {
    mockNavigatorPlatform({
      platform: "Win32",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Firefox/147.0",
    });

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    fireEvent.keyDown(window, {
      key: "I",
      code: "KeyI",
      ctrlKey: true,
    });
    expect(useViewStore.getState().newIssueDialogOpen).toBe(false);

    fireEvent.keyDown(window, {
      key: "N",
      code: "KeyN",
      ctrlKey: true,
      altKey: true,
    });
    expect(useViewStore.getState().newIssueDialogOpen).toBe(true);
  });

  it("ignores unadvertised Control+I on macOS", () => {
    mockNavigatorPlatform({
      platform: "MacIntel",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    });

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    fireEvent.keyDown(window, {
      key: "I",
      code: "KeyI",
      ctrlKey: true,
    });
    expect(useViewStore.getState().newIssueDialogOpen).toBe(false);

    fireEvent.keyDown(window, {
      key: "I",
      code: "KeyI",
      metaKey: true,
    });
    expect(useViewStore.getState().newIssueDialogOpen).toBe(true);
  });

  it("keeps the collapsed shortcuts utility above the identity controls (REEF-170)", () => {
    useViewStore.setState({ sidebarCollapsed: true });

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    const utility = screen.getByTestId("sidebar-footer-shortcuts");
    const shortcut = within(utility).getByTestId("sidebar-shortcuts-trigger");
    const workspace = screen.getByTestId("sidebar-workspace");

    expect(utility).toHaveClass("py-1");
    expect(shortcut).toHaveClass("h-8", "w-8", "justify-center");
    expect(shortcut).not.toHaveTextContent("Keyboard shortcuts");
    expect(utility.compareDocumentPosition(workspace)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("shows the real pending Suggestions count in the expanded sidebar", () => {
    pendingSuggestionsState.count = 12;

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    const badge = screen.getByTestId("suggestions-pending-badge");
    expect(badge).toHaveTextContent("9+");
    expect(badge).toHaveAccessibleName("12 pending suggestions");
  });

  it("keeps the pending Suggestions badge visible on the active route", () => {
    navigationState.pathname = "/workspace/reef-acme/suggestions";
    pendingSuggestionsState.count = 3;

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    expect(screen.getByRole("link", { name: /Suggestions/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("suggestions-pending-badge")).toBeVisible();
  });

  it("keeps the collapsed Suggestions pending dot visible and named", () => {
    useViewStore.setState({ sidebarCollapsed: true });
    pendingSuggestionsState.count = 3;

    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    const dot = screen.getByTestId("suggestions-pending-dot");
    expect(dot).toBeVisible();
    expect(dot).toHaveAccessibleName("3 pending suggestions");
  });

  it("uses the Korean Suggestions label and pending-count name", () => {
    pendingSuggestionsState.count = 2;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <IntlTestProvider locale="ko">
          <DashboardShell appVersion="0.0.0">
            <div>children</div>
          </DashboardShell>
        </IntlTestProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("link", { name: /제안/ })).toHaveAttribute(
      "href",
      "/workspace/reef-acme/suggestions",
    );
    expect(
      screen.getByTestId("suggestions-pending-badge"),
    ).toHaveAccessibleName("미처리 제안 2개");
  });

  it("navigates to Suggestions with G S and leaves G A unbound", () => {
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "s" });
    expect(navigationState.push).toHaveBeenCalledWith(
      "/workspace/reef-acme/suggestions",
    );

    navigationState.push.mockClear();
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "a" });
    expect(navigationState.push).not.toHaveBeenCalled();
  });

  it("advertises the Suggestions name and G S chord in shortcut help", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <DashboardShell appVersion="0.0.0">
          <div>children</div>
        </DashboardShell>,
      ),
    );

    await user.click(
      screen.getByRole("button", { name: "Keyboard shortcuts" }),
    );
    const dialog = screen.getByTestId("keyboard-shortcuts-dialog");
    expect(within(dialog).getByText("Go to Suggestions")).toBeVisible();
    const row = within(dialog).getByText("Go to Suggestions").closest("li");
    expect(row).toHaveTextContent("G");
    expect(row).toHaveTextContent("S");
    expect(
      within(dialog).queryByText("Go to Activity"),
    ).not.toBeInTheDocument();
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
    // Orange (warn) advisory tone, not the destructive red reserved for My
    // Work's missed commitments.
    expect(badge).toHaveClass("bg-priority-high");
    expect(badge).toHaveAccessibleName(
      "Workspace instructions update available",
    );
    // It is a count-less dot, not a numeric pill — the label is the sole signal.
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
    navigationState.pathname = "/workspace/reef-acme/settings/workspace";
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
    navigationState.pathname = "/workspace/reef-acme/issues/REEF-001";
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
    navigationState.pathname = "/workspace/reef-acme/settings/workspace";
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
