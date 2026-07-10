"use client";

import { Button } from "@/components/ui/button";
import { ReefMark } from "@/components/ui/reef-mark";
import { ACTIVITY_SUGGESTIONS_QUERY_KEY } from "@/features/activity/hooks/useActivityFeed";
import { useActivityRepo } from "@/features/activity/hooks/useActivityRepo";
import {
  useScanActivity,
  useScanAutoTrigger,
} from "@/features/activity/hooks/useScanActivity";
import {
  UNREAD_INBOX_QUERY_KEY,
  useUnreadInboxCount,
} from "@/features/activity/hooks/useUnreadInboxCount";
import { AskAiFab } from "@/features/ai/components/AskAiFab";
import { useAskAiStore } from "@/features/ai/stores/useAskAiStore";
import { SidebarAccount } from "@/features/auth/components/SidebarAccount";
import { SidebarWorkspace } from "@/features/auth/components/SidebarWorkspace";
import { NewIssueDialog } from "@/features/issues/components/create/NewIssueDialog";
import { buildOpenIssueHref } from "@/features/issues/lib/issueHref";
import {
  type IssueKeyboardScope,
  type IssueQuickEditField,
  useIssueKeyboardStore,
} from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { useMyWorkAttention } from "@/features/my-work/hooks/useMyWorkAttention";
import { OfflineBanner } from "@/features/network/components/OfflineBanner";
import { CreateWorkspaceDialog } from "@/features/onboarding/components/CreateWorkspaceDialog";
import { useLocaleSync } from "@/features/preferences/hooks/useLocaleSync";
import { useThemeSync } from "@/features/preferences/hooks/useThemeSync";
import { GlobalSearchDialog } from "@/features/search/components/GlobalSearchDialog";
import { useGlobalSearchStore } from "@/features/search/stores/useGlobalSearchStore";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useProjectConfig } from "@/features/settings/hooks/useProjectConfig";
import { useWorkspaceSkillStatus } from "@/features/settings/hooks/useWorkspaceSkillStatus";
import { KeyboardShortcutsDialog } from "@/features/shortcuts/components/KeyboardShortcutsDialog";
import {
  type ShortcutBinding,
  type ShortcutScope,
  dispatchShortcut,
  formatShortcut,
  getNewIssueShortcutKeys,
  isFirefoxLike,
  isMacLike,
} from "@/features/shortcuts/lib/shortcuts";
import { useShortcutsStore } from "@/features/shortcuts/stores/useShortcutsStore";
import { useViewStore } from "@/features/ui/stores/useViewStore";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  ChevronLeft,
  CircleUser,
  Inbox,
  ListTodo,
  type LucideIcon,
  Milestone,
  Plus,
  Settings,
} from "lucide-react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { SidebarFooterShortcuts } from "./SidebarFooterShortcuts";

// The Ask AI panel pulls in the chat heavy deps (streamdown + its mermaid/
// math/code/CJK plugins, the AI SDK). Load it lazily and after the first
// open (see `chatMounted` below) so none of it lands in the dashboard's initial
// bundle; once mounted it stays mounted so chat history survives close/open.
// (REEF-097 AC3)
const AskAiDialog = dynamic(
  () =>
    import("@/features/ai/components/AskAiDialog").then((m) => m.AskAiDialog),
  { ssr: false },
);

// Warm the chunk on FAB hover/focus so the panel is ready by the time it opens.
function preloadAskAiDialog() {
  if (typeof window !== "undefined") {
    void import("@/features/ai/components/AskAiDialog");
  }
}

function subscribeToPlatformStore() {
  return () => {};
}

interface DashboardShellProps {
  children: React.ReactNode;
  appVersion: string;
}

// `labelKey` resolves through the `nav` catalog at render (REEF-293); `testId`
// is the stable English slug for `data-testid` / e2e locators so the markup
// anchor stays stable across active locales.
const navLinks: ReadonlyArray<{
  href: string;
  labelKey:
    | "issues"
    | "myWork"
    | "planning"
    | "activity"
    | "reports"
    | "settings";
  testId: string;
  icon: LucideIcon;
}> = [
  { href: "/issues", labelKey: "issues", testId: "issues", icon: ListTodo },
  // My Work sits right after Issues (REEF-204 / REEF-181 AC1) — a personal lens
  // on the same work, distinct from the board's `ListTodo` via `CircleUser`.
  { href: "/my-work", labelKey: "myWork", testId: "my work", icon: CircleUser },
  {
    href: "/planning",
    labelKey: "planning",
    testId: "planning",
    icon: Milestone,
  },
  { href: "/activity", labelKey: "activity", testId: "activity", icon: Inbox },
  { href: "/reports", labelKey: "reports", testId: "reports", icon: BarChart3 },
  {
    href: "/settings",
    labelKey: "settings",
    testId: "settings",
    icon: Settings,
  },
] as const;

/** A sidebar nav badge (REEF-204): the Activity "unread" pill and the My
 * Work "needs attention" pill share one render path, differing in tone.
 * Filled-pill + white foreground is the sidebar's badge vocabulary (the count is
 * also carried by an aria-label, so the small chip is not the signal). */
type NavBadgeTone = "brand" | "danger" | "warn";

const NAV_BADGE_PILL: Record<NavBadgeTone, string> = {
  brand: "bg-brand text-brand-foreground",
  danger: "bg-destructive text-destructive-foreground",
  warn: "bg-priority-high text-white",
};

const NAV_BADGE_DOT: Record<NavBadgeTone, string> = {
  brand: "bg-brand",
  danger: "bg-destructive",
  warn: "bg-priority-high",
};

interface NavBadge {
  /** "count" → a numeric pill when expanded, a dot when collapsed (Activity, My
   * Work). "state" → a dot in both layouts: a binary signal that carries no
   * quantity, so a counting pill would be the wrong vocabulary (REEF-257 — the
   * workspace skill is either drifted or not). */
  kind: "count" | "state";
  /** Capped display text for a count badge, e.g. "9+". Unused when kind is
   * "state" (a dot shows no number). */
  display: string;
  /** Full accessible label — the real counts for a count badge, the state for a
   * state badge. The dot/pill is silent, so this label is the sole signal. */
  label: string;
  tone: NavBadgeTone;
  badgeTestId: string;
  dotTestId: string;
}

const cap = (n: number) => (n > 9 ? "9+" : String(n));

export function DashboardShell({ children, appVersion }: DashboardShellProps) {
  const sidebarCollapsed = useViewStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useViewStore((state) => state.toggleSidebar);
  const openNewIssueDialog = useViewStore((state) => state.openNewIssueDialog);
  const openBlankNewIssueDialog = useCallback(() => {
    openNewIssueDialog();
  }, [openNewIssueDialog]);
  const toggleAskAi = useAskAiStore((state) => state.toggle);
  const toggleGlobalSearch = useGlobalSearchStore((state) => state.toggle);
  const toggleShortcuts = useShortcutsStore((state) => state.toggle);
  const moveIssueFocus = useIssueKeyboardStore((state) => state.moveFocus);
  const requestQuickEdit = useIssueKeyboardStore(
    (state) => state.requestQuickEdit,
  );
  const selectionActive = useIssueSelectionStore(
    (state) => state.selectedIds.size > 0,
  );
  const clearIssueSelection = useIssueSelectionStore((state) => state.clear);
  // Singleton theme side-effects (one-time hydrate + OS `system` listener).
  // The shell is consistently mounted, so this is the one place they run; every
  // theme control reads the shared store via useTheme (REEF-095).
  useThemeSync();
  // Singleton locale side-effects (one-time hydrate + cookie/lang reconcile),
  // mirroring useThemeSync. Restores a persisted locale if the cookie was
  // cleared (REEF-291).
  useLocaleSync();
  const t = useTranslations("nav");
  const pathname = usePathname();
  const router = useRouter();
  // Keep the assistant message count in DashboardShell so the FAB can show
  // an unread dot without subscribing to the chat runtime itself.
  const [askAiMessageCount, setAskAiMessageCount] = useState(0);
  // Mount the lazy Ask AI panel on first open and keep it mounted thereafter,
  // so its chunk loads when used and chat history survives close/open.
  const askAiOpen = useAskAiStore((state) => state.isOpen);
  const [chatMounted, setChatMounted] = useState(
    () => useAskAiStore.getState().isOpen,
  );
  useEffect(() => {
    return useAskAiStore.subscribe((state) => {
      if (state.isOpen) {
        setChatMounted(true);
      }
    });
  }, []);

  const macLike = useSyncExternalStore(
    subscribeToPlatformStore,
    isMacLike,
    () => null,
  );
  const newIssueShortcut =
    macLike === null
      ? null
      : formatShortcut(getNewIssueShortcutKeys(), macLike);
  const newIssueLabel = newIssueShortcut
    ? t("newIssueAriaLabel", { shortcut: newIssueShortcut })
    : t("newIssue");

  // Auto-detection trigger lives at the shell so it fires regardless of which
  // page the user is on — Board / List / Settings all benefit. ActivityFeed
  // keeps its own mutation for the manual refresh button (separate instance,
  // same AKB activity inbox, same invalidation channel).
  const { vault } = useActiveVault();
  const queryClient = useQueryClient();

  // Prime the `['config', vault]` query cache for the active vault. Other
  // features (NewIssueDialog, AskAiDialog, detection) call `ensureProjectConfig`
  // against the same cache key and dedupe to this fetch instead of issuing
  // their own.
  useProjectConfig(vault);
  // The auto-trigger needs a GitHub `owner/name`, not the vault — passing the
  // vault here is what made detection silently no-op before. `useActivityRepo`
  // returns the user's persisted scan target (or first monitored repo) and
  // empty-string when the vault has no monitored repos at all; the trigger
  // already gates on `!repo` so the empty case naturally suppresses scans.
  const { repo: scanRepo } = useActivityRepo(vault);
  const scan = useScanActivity({
    onSuccess: (result) => {
      if (result.addedDrafts + result.addedStatusChanges > 0) {
        void queryClient.invalidateQueries({
          queryKey: ACTIVITY_SUGGESTIONS_QUERY_KEY,
        });
        void queryClient.invalidateQueries({
          queryKey: UNREAD_INBOX_QUERY_KEY,
        });
      }
    },
  });
  useScanAutoTrigger(vault, scanRepo, scan.mutate);

  // Unread count for the sidebar Activity badge. Hidden while the user is
  // already on /activity — they can see the items themselves and ActivityFeed
  // updates `last_visit_at` on mount to clear it.
  const unreadInboxCount = useUnreadInboxCount(vault);

  // My Work "needs attention" count for its sidebar badge (REEF-204): the
  // signed-in user's overdue + due-soon work, derived from MyWorkPage's same
  // `useIssueList` cache (no extra fetch). Hidden while on /my-work, like the
  // Activity badge.
  const { attention, overdue, dueSoon } = useMyWorkAttention();

  // Workspace skill (agent-playbook) drift for the sidebar Settings badge
  // (REEF-257). The status is read by agents, not the PM, so it stays invisible
  // until a surface shows it; this lifts the existing Settings-page signal up to
  // the persistent sidebar. Rides the same `["vault-skill", vault]` query the
  // settings section uses (5-min cache, no extra fetch), so applying the update
  // — which primes that cache — clears the badge automatically.
  const skillStatus = useWorkspaceSkillStatus(vault);
  // An explicit `up_to_date === false` lights the badge; while the status
  // is loading, errored, or for a vault-less shell the data is undefined and the
  // badge stays dark (REEF-257 AC3).
  const skillOutdated = skillStatus.data?.up_to_date === false;

  // Resolve the badge a nav link shows, if any. Returns null while the link is
  // active so the page itself owns the signal then (matches Activity; for
  // Settings the drift detail + update affordance lives on the page).
  function navBadgeFor(href: string, isActive: boolean): NavBadge | null {
    if (isActive) return null;
    if (href === "/activity" && unreadInboxCount > 0) {
      return {
        kind: "count",
        display: cap(unreadInboxCount),
        label: t("badge.unread", { count: unreadInboxCount }),
        tone: "brand",
        badgeTestId: "activity-unread-badge",
        dotTestId: "activity-unread-dot",
      };
    }
    if (href === "/my-work" && attention > 0) {
      const parts: string[] = [];
      if (overdue > 0) parts.push(t("badge.overdue", { count: overdue }));
      if (dueSoon > 0) parts.push(t("badge.dueSoon", { count: dueSoon }));
      return {
        kind: "count",
        display: cap(attention),
        label: parts.join(", "),
        // overdue dominates the tone: any overdue work reads as destructive,
        // otherwise the due-soon-badge is the softer orange (REEF-204).
        tone: overdue > 0 ? "danger" : "warn",
        badgeTestId: "my-work-attention-badge",
        dotTestId: "my-work-attention-dot",
      };
    }
    if (href === "/settings" && skillOutdated) {
      return {
        // Not a count — drift is a binary state, so it shows as a dot in both
        // layouts rather than a pill (anti-slop: encode the one state once,
        // reuse the dot vocabulary). `warn` (orange), matching the advisory tone
        // of the Settings-page "Newer AI instructions are available." box;
        // destructive red stays reserved for missed commitments (My Work).
        kind: "state",
        display: "",
        label: t("badge.skillUpdate"),
        tone: "warn",
        badgeTestId: "workspace-skill-badge",
        dotTestId: "workspace-skill-dot",
      };
    }
    return null;
  }

  const chordRef = useRef<{ prefix: string; timer: number | null } | null>(
    null,
  );

  const clearChord = useCallback(() => {
    if (chordRef.current?.timer) {
      window.clearTimeout(chordRef.current.timer);
    }
    chordRef.current = null;
  }, []);

  const startChord = useCallback(
    (prefix: string) => {
      clearChord();
      chordRef.current = {
        prefix,
        timer: window.setTimeout(clearChord, 800),
      };
    },
    [clearChord],
  );

  const navigateTo = useCallback(
    (href: string) => {
      clearChord();
      router.push(withVault(vault, href));
    },
    [clearChord, router, vault],
  );

  const resolveShortcutScope = useCallback((): ShortcutScope => {
    if (typeof window === "undefined") return "global";
    const path = window.location.pathname;
    if (!path.includes("/issues")) return "global";
    if (/\/issues\/[^/]+/.test(path)) return "detail";
    const view = new URLSearchParams(window.location.search).get("view");
    if (view === "list") return "list";
    if (view === "board" || view == null) return "board";
    return "global";
  }, []);

  const openFocusedIssue = useCallback(
    (scope: IssueKeyboardScope) => {
      const issueId = useIssueKeyboardStore.getState().focusedIssueId[scope];
      if (!issueId) return;
      const query =
        typeof window === "undefined"
          ? new URLSearchParams()
          : new URLSearchParams(window.location.search);
      router.push(buildOpenIssueHref(vault, issueId, query));
    },
    [router, vault],
  );

  const editFocusedIssue = useCallback(
    (scope: IssueKeyboardScope, field: IssueQuickEditField) => {
      if (selectionActive) return;
      requestQuickEdit(scope, field);
    },
    [requestQuickEdit, selectionActive],
  );

  const shortcutRegistry = useMemo<ShortcutBinding[]>(
    () => [
      {
        labelKey: "showKeyboardShortcuts",
        scope: "global",
        keys: [
          { key: "?", modKey: true, shiftKey: true },
          { key: "/", modKey: true, shiftKey: true },
        ],
        allowEditableTarget: true,
        allowInteractiveTarget: true,
        handler: toggleShortcuts,
      },
      {
        labelKey: "openGlobalSearch",
        scope: "global",
        keys: [{ key: "k", modKey: true }],
        allowEditableTarget: true,
        allowInteractiveTarget: true,
        handler: toggleGlobalSearch,
      },
      {
        labelKey: "newIssue",
        scope: "global",
        keys: isFirefoxLike()
          ? [{ key: "n", code: "KeyN", primaryModKey: true, altKey: true }]
          : [{ key: "i", code: "KeyI", primaryModKey: true }],
        allowInteractiveTarget: true,
        handler: openBlankNewIssueDialog,
      },
      {
        labelKey: "toggleAskAi",
        scope: "global",
        keys: [{ key: "a", modKey: true, shiftKey: true }],
        allowInteractiveTarget: true,
        handler: toggleAskAi,
      },
      {
        labelKey: "goIssues",
        scope: "global",
        keys: [{ key: "g" }],
        handler: () => startChord("g"),
      },
      {
        labelKey: "goIssues",
        scope: "global",
        chordPrefix: "g",
        keys: [{ key: "i" }],
        handler: () => navigateTo("/issues"),
      },
      {
        labelKey: "goMyWork",
        scope: "global",
        chordPrefix: "g",
        keys: [{ key: "m" }],
        handler: () => navigateTo("/my-work"),
      },
      {
        labelKey: "goActivity",
        scope: "global",
        chordPrefix: "g",
        keys: [{ key: "a" }],
        handler: () => navigateTo("/activity"),
      },
      {
        labelKey: "goReports",
        scope: "global",
        chordPrefix: "g",
        keys: [{ key: "r" }],
        handler: () => navigateTo("/reports"),
      },
      {
        labelKey: "goBacklog",
        scope: "global",
        chordPrefix: "g",
        keys: [{ key: "b" }],
        handler: () => navigateTo("/issues?view=backlog"),
      },
      ...(["list", "board"] as const).flatMap<ShortcutBinding>((scope) => [
        {
          labelKey: "closeDialogClearSearch" as const,
          scope,
          keys: [{ key: "Escape" }],
          handler: clearIssueSelection,
        },
        {
          labelKey: "focusNextIssue" as const,
          scope,
          keys: [{ key: "j" }, { key: "ArrowDown" }],
          handler: () => moveIssueFocus(scope, 1),
        },
        {
          labelKey: "focusPreviousIssue" as const,
          scope,
          keys: [{ key: "k" }, { key: "ArrowUp" }],
          handler: () => moveIssueFocus(scope, -1),
        },
        {
          labelKey: "openFocusedIssue" as const,
          scope,
          keys: [{ key: "Enter" }],
          handler: () => openFocusedIssue(scope),
        },
        {
          labelKey: "editStatus" as const,
          scope,
          keys: [{ key: "s" }],
          handler: () => editFocusedIssue(scope, "status"),
        },
        {
          labelKey: "editAssignee" as const,
          scope,
          keys: [{ key: "a" }],
          handler: () => editFocusedIssue(scope, "assignee"),
        },
        {
          labelKey: "editPriority" as const,
          scope,
          keys: [{ key: "p" }],
          handler: () => editFocusedIssue(scope, "priority"),
        },
        {
          labelKey: "editLabels" as const,
          scope,
          keys: [{ key: "l" }],
          handler: () => editFocusedIssue(scope, "labels"),
        },
      ]),
    ],
    [
      editFocusedIssue,
      clearIssueSelection,
      moveIssueFocus,
      navigateTo,
      openFocusedIssue,
      openBlankNewIssueDialog,
      startChord,
      toggleAskAi,
      toggleGlobalSearch,
      toggleShortcuts,
    ],
  );

  // Global shortcut dispatcher. Bindings are declared above with scope +
  // key contracts; this stays the shell's single keydown listener.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const result = dispatchShortcut(
        e,
        shortcutRegistry,
        resolveShortcutScope(),
        chordRef.current?.prefix ?? null,
      );
      if (!result.handled && chordRef.current) {
        clearChord();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearChord();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [clearChord, resolveShortcutScope, shortcutRegistry]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col bg-sidebar border-r border-border-subtle",
          // Collapse snaps rather than animating width: a width transition
          // reflows the main content every frame, and this is a low-frequency
          // explicit toggle, not a hot path. (REEF-097 AC3)
          sidebarCollapsed ? "w-14" : "w-60",
        )}
        aria-label={t("sidebarLandmark")}
      >
        {/* Brand header */}
        <div
          className={cn(
            "flex h-12 items-center border-b border-border-subtle",
            sidebarCollapsed ? "justify-center px-0" : "justify-between px-3",
          )}
        >
          {sidebarCollapsed ? (
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={t("expandSidebar")}
              title={t("expandSidebar")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <ReefMark
                className="size-6"
                decorative
                data-testid="sidebar-brand-mark"
              />
            </button>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <ReefMark
                  className="size-6"
                  decorative
                  data-testid="sidebar-brand-mark"
                />
                <span
                  className="font-display text-[15px] font-semibold tracking-tight text-foreground"
                  data-testid="sidebar-brand-name"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  reef{/* i18n-exempt: brand name */}
                </span>
              </div>
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label={t("collapseSidebar")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {/* New Issue button */}
        <div className={cn("px-2 pt-3", sidebarCollapsed && "px-1.5")}>
          <Button
            type="button"
            size="sm"
            onClick={openBlankNewIssueDialog}
            data-testid="new-issue-trigger"
            aria-label={newIssueLabel}
            title={newIssueLabel}
            className={cn("w-full", sidebarCollapsed && "px-0")}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            {!sidebarCollapsed && <span>{t("newIssue")}</span>}
          </Button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-2 py-3" aria-label={t("mainNavLandmark")}>
          <ul className="flex flex-col gap-0.5">
            {navLinks.map(({ href, labelKey, testId, icon: Icon }) => {
              const label = t(labelKey);
              // The nav targets are vault-scoped (`/workspace/{vault}/issues`)
              // so the active workspace stays in the URL (REEF-315). Badge
              // resolution still keys off the stable base `href`.
              const fullHref = withVault(vault, href);
              // A nav link owns its whole section: it stays active on an exact
              // match or any nested route under it — /issues/[id] keeps Issues
              // active while the detail slide-over is open, and /settings/<tab>
              // keeps Settings active across the scope tabs (REEF-183).
              const isActive =
                pathname === fullHref || pathname.startsWith(`${fullHref}/`);
              const badge = navBadgeFor(href, isActive);
              return (
                <li key={href} className="relative">
                  {/* Active rail */}
                  {isActive && (
                    <span
                      className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand"
                      aria-hidden="true"
                    />
                  )}
                  <Link
                    href={fullHref}
                    title={sidebarCollapsed ? label : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                      isActive
                        ? "bg-surface-hover text-foreground font-medium"
                        : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                      sidebarCollapsed && "h-9 justify-center px-0",
                    )}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {sidebarCollapsed ? (
                      <>
                        <span className="sr-only">{label}</span>
                        <Icon
                          aria-hidden="true"
                          data-testid={`sidebar-nav-icon-${testId}`}
                          className="h-[18px] w-[18px] shrink-0 stroke-[1.9]"
                        />
                        {badge && (
                          <span
                            data-testid={badge.dotTestId}
                            className={cn(
                              "absolute right-1 top-1 h-1.5 w-1.5 rounded-full",
                              NAV_BADGE_DOT[badge.tone],
                            )}
                            aria-label={badge.label}
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <span className="flex-1">{label}</span>
                        {badge &&
                          (badge.kind === "state" ? (
                            // A count-less state shows the same dot as the
                            // collapsed layout, parked in the badge gutter where
                            // the count pills sit so the right edge stays a single
                            // scan column (REEF-257).
                            <span
                              data-testid={badge.badgeTestId}
                              aria-label={badge.label}
                              className={cn(
                                "ml-auto inline-block h-1.5 w-1.5 rounded-full",
                                NAV_BADGE_DOT[badge.tone],
                              )}
                            />
                          ) : (
                            <span
                              data-testid={badge.badgeTestId}
                              aria-label={badge.label}
                              className={cn(
                                "ml-auto inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums",
                                NAV_BADGE_PILL[badge.tone],
                              )}
                            >
                              {badge.display}
                            </span>
                          ))}
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer — one global utility row, then a two-tier identity block.
            Keyboard shortcuts are app chrome; workspace (place, REEF-146) and
            account (person, REEF-068) stay grouped below so their identity
            meanings remain distinct. */}
        <SidebarFooterShortcuts collapsed={sidebarCollapsed} />
        <SidebarWorkspace collapsed={sidebarCollapsed} />
        <SidebarAccount appVersion={appVersion} collapsed={sidebarCollapsed} />
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <OfflineBanner />
        <main className="flex-1 overflow-auto bg-background">{children}</main>
      </div>

      {/* Global new-issue dialog — single instance for the whole shell so any
          trigger (sidebar button, keyboard shortcut, future quick-add) shares
          state. */}
      <NewIssueDialog />

      {/* Global create-workspace dialog (REEF-146) — single instance opened
          from the sidebar workspace switcher (and later Settings, REEF-147). */}
      <CreateWorkspaceDialog />

      {/* Global ⌘K search palette. consistently mounted; controlled via
          useGlobalSearchStore so the keyboard shortcut and any future
          toolbar trigger share one canonical source. */}
      <GlobalSearchDialog />

      {/* Keyboard shortcuts cheat sheet (⌘?). Same single-mount pattern —
          opened by the keybinding for now, but a future "Help" entry
          in the sidebar can flip the same store. */}
      <KeyboardShortcutsDialog />

      {/* Global Ask AI panel + FAB. The panel is lazily mounted on first open
          (chatMounted) so the chat bundle stays out of first load; once
          mounted it stays mounted so chat history survives close/open, with
          visibility toggled internally. The FAB warms the chunk on intent. */}
      {chatMounted && (
        <AskAiDialog onMessageCountChange={setAskAiMessageCount} />
      )}
      <AskAiFab
        messageCount={askAiMessageCount}
        onPreload={preloadAskAiDialog}
      />
    </div>
  );
}
