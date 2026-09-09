"use client";

import { Button } from "@/components/ui/button";
import { ReefMark } from "@/components/ui/reef-mark";
import {
  SIDEBAR_ASIDE_CLASS,
  SIDEBAR_BRAND_HEADER_CLASS,
  SIDEBAR_NAV_ACTIVE_CLASS,
  SIDEBAR_NAV_COLLAPSED_CLASS,
  SIDEBAR_NAV_INACTIVE_CLASS,
  SIDEBAR_NAV_ITEMS,
  SIDEBAR_NAV_LINK_CLASS,
  SIDEBAR_TOGGLE_CLASS,
} from "@/components/sidebarChrome";
import { AskAiFab } from "@/features/ai/components/AskAiFab";
import { useAskAiStore } from "@/features/ai/stores/useAskAiStore";
import { SidebarAccount } from "@/features/auth/components/SidebarAccount";
import { SidebarWorkspace } from "@/features/auth/components/SidebarWorkspace";
import { useCommandRegistry } from "@/features/commands/hooks/useCommandRegistry";
import { useUnreadNotificationCount } from "@/features/inbox/hooks/useInboxNotifications";
import { buildOpenIssueHref } from "@/features/issues/lib/issueHref";
import { parseIssueViewState } from "@/features/issues/lib/viewMode";
import {
  type IssueKeyboardScope,
  type IssueQuickEditField,
  useIssueKeyboardStore,
} from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { useMyWorkAttention } from "@/features/my-work/hooks/useMyWorkAttention";
import { OfflineBanner } from "@/features/network/components/OfflineBanner";
import { useLocaleSync } from "@/features/preferences/hooks/useLocaleSync";
import { useGlobalSearchStore } from "@/features/search/stores/useGlobalSearchStore";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useProjectConfig } from "@/features/settings/hooks/useProjectConfig";
import { useWorkspaceSkillStatus } from "@/features/settings/hooks/useWorkspaceSkillStatus";
import {
  type ShortcutScope,
  dispatchShortcut,
  formatShortcut,
  getNewIssueShortcutKeys,
  isMacLike,
} from "@/features/shortcuts/lib/shortcuts";
import { useShortcutsStore } from "@/features/shortcuts/stores/useShortcutsStore";
import { useViewStore } from "@/features/ui/stores/useViewStore";
import { LazyLoadFallback } from "@/features/ui/components/LazyLoadFallback";
import {
  preloadAskAiDialog,
  preloadCreateWorkspaceDialog,
  preloadGlobalSearchDialog,
  preloadKeyboardShortcutsDialog,
  preloadNewIssueDialog,
} from "@/features/ui/lib/lazyDialogPreload";
import { useHydrated } from "@/lib/useHydrated";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { ChevronLeft, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
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
  {
    ssr: false,
    loading: (props) => (
      <AskAiDialogLoading error={props.error} retry={props.retry} />
    ),
  },
);

interface DynamicLoadingProps {
  error?: Error | null;
  retry?: () => void;
}

function AskAiDialogLoading({ error, retry }: DynamicLoadingProps) {
  const open = useAskAiStore((state) => state.isOpen);
  const dismiss = useAskAiStore((state) => state.close);
  if (!open) return null;
  return (
    <LazyLoadFallback
      error={error}
      retry={retry}
      surface="dialog"
      testId="ask-ai-dialog-loading"
      onDismiss={dismiss}
    />
  );
}

function NewIssueDialogLoading({ error, retry }: DynamicLoadingProps) {
  const open = useViewStore((state) => state.newIssueDialogOpen);
  const dismiss = useViewStore((state) => state.closeNewIssueDialog);
  if (!open) return null;
  return (
    <LazyLoadFallback
      error={error}
      retry={retry}
      surface="dialog"
      testId="new-issue-dialog-loading"
      onDismiss={dismiss}
    />
  );
}

function CreateWorkspaceDialogLoading({ error, retry }: DynamicLoadingProps) {
  const open = useViewStore((state) => state.createWorkspaceDialogOpen);
  const dismiss = useViewStore((state) => state.closeCreateWorkspaceDialog);
  if (!open) return null;
  return (
    <LazyLoadFallback
      error={error}
      retry={retry}
      surface="dialog"
      testId="create-workspace-dialog-loading"
      onDismiss={dismiss}
    />
  );
}

function GlobalSearchDialogLoading({ error, retry }: DynamicLoadingProps) {
  const open = useGlobalSearchStore((state) => state.isOpen);
  const dismiss = useGlobalSearchStore((state) => state.close);
  if (!open) return null;
  return (
    <LazyLoadFallback
      error={error}
      retry={retry}
      surface="dialog"
      testId="global-search-dialog-loading"
      onDismiss={dismiss}
    />
  );
}

function KeyboardShortcutsDialogLoading({ error, retry }: DynamicLoadingProps) {
  const open = useShortcutsStore((state) => state.isOpen);
  const dismiss = useShortcutsStore((state) => state.close);
  if (!open) return null;
  return (
    <LazyLoadFallback
      error={error}
      retry={retry}
      surface="dialog"
      testId="keyboard-shortcuts-dialog-loading"
      onDismiss={dismiss}
    />
  );
}

function CloseIssueDialogLoading({ error, retry }: DynamicLoadingProps) {
  return (
    <LazyLoadFallback
      error={error}
      retry={retry}
      surface="dialog"
      testId="close-issue-dialog-loading"
    />
  );
}

const NewIssueDialog = dynamic(
  () =>
    import("@/features/issues/components/create/NewIssueDialog").then(
      (module) => module.NewIssueDialog,
    ),
  {
    ssr: false,
    loading: (props) => (
      <NewIssueDialogLoading error={props.error} retry={props.retry} />
    ),
  },
);

const CreateWorkspaceDialog = dynamic(
  () =>
    import("@/features/onboarding/components/CreateWorkspaceDialog").then(
      (module) => module.CreateWorkspaceDialog,
    ),
  {
    ssr: false,
    loading: (props) => (
      <CreateWorkspaceDialogLoading error={props.error} retry={props.retry} />
    ),
  },
);

const GlobalSearchDialog = dynamic(
  () =>
    import("@/features/search/components/GlobalSearchDialog").then(
      (module) => module.GlobalSearchDialog,
    ),
  {
    ssr: false,
    loading: (props) => (
      <GlobalSearchDialogLoading error={props.error} retry={props.retry} />
    ),
  },
);

const KeyboardShortcutsDialog = dynamic(
  () =>
    import("@/features/shortcuts/components/KeyboardShortcutsDialog").then(
      (module) => module.KeyboardShortcutsDialog,
    ),
  {
    ssr: false,
    loading: (props) => (
      <KeyboardShortcutsDialogLoading error={props.error} retry={props.retry} />
    ),
  },
);

const CloseIssueDialog = dynamic(
  () =>
    import("@/features/issues/components/detail/CloseIssueDialog").then(
      (module) => module.CloseIssueDialog,
    ),
  {
    ssr: false,
    loading: (props) => (
      <CloseIssueDialogLoading error={props.error} retry={props.retry} />
    ),
  },
);

function useMountAfterOpen(open: boolean): boolean {
  const [hasOpened, setHasOpened] = useState(() => open);

  useEffect(() => {
    if (!open || hasOpened) return;
    // The first open is already reflected by `open`; retain the mounted
    // component after that point so Radix can finish close-focus handoffs.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this records a one-way interaction boundary.
    setHasOpened(true);
  }, [hasOpened, open]);

  return hasOpened || open;
}

function subscribeToPlatformStore() {
  return () => {};
}

const MOBILE_SIDEBAR_MEDIA_QUERY = "(max-width: 767px)";
const COMMAND_FOCUS_PENDING_ATTRIBUTE = "data-reef-command-focus-pending";

function subscribeToMobileSidebar(onStoreChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return () => {};

  const mediaQuery = window.matchMedia(MOBILE_SIDEBAR_MEDIA_QUERY);
  if (typeof mediaQuery.addEventListener !== "function") return () => {};
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getMobileSidebarSnapshot(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_SIDEBAR_MEDIA_QUERY).matches
  );
}

function getServerMobileSidebarSnapshot(): boolean {
  return false;
}

interface DashboardShellProps {
  children: React.ReactNode;
  appVersion: string;
}

/** A sidebar nav badge: My Work attention and Settings drift share one render
 * path, differing in tone.
 * Filled-pill + white foreground is the sidebar's badge vocabulary (the count is
 * also carried by an aria-label, so the small chip is not the signal). */
type NavBadgeTone = "brand" | "danger" | "warn";

const NAV_BADGE_PILL: Record<NavBadgeTone, string> = {
  brand: "bg-brand-fill text-brand-on-fill",
  danger: "bg-destructive-fill text-destructive-on-fill",
  warn: "bg-priority-high text-white",
};

const NAV_BADGE_DOT: Record<NavBadgeTone, string> = {
  brand: "bg-brand-fill",
  danger: "bg-destructive-fill",
  warn: "bg-priority-high",
};

interface NavBadge {
  /** "count" → a numeric pill when expanded, a dot when collapsed (My Work).
   * "state" → a dot in both layouts: a binary signal that carries no
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
  const hydrated = useHydrated();
  const interactionReady = hydrated;
  const storedSidebarCollapsed = useViewStore(
    (state) => state.sidebarCollapsed,
  );
  const mobileSidebarCollapsed = useSyncExternalStore(
    subscribeToMobileSidebar,
    getMobileSidebarSnapshot,
    getServerMobileSidebarSnapshot,
  );
  const sidebarCollapsed = storedSidebarCollapsed || mobileSidebarCollapsed;
  const toggleSidebar = useViewStore((state) => state.toggleSidebar);
  const openNewIssueDialog = useViewStore((state) => state.openNewIssueDialog);
  const newIssueDialogOpen = useViewStore((state) => state.newIssueDialogOpen);
  const createWorkspaceDialogOpen = useViewStore(
    (state) => state.createWorkspaceDialogOpen,
  );
  const newIssueFocusOriginRef = useRef<HTMLElement | null>(null);
  const openBlankNewIssueDialog = useCallback(() => {
    const active = document.activeElement;
    newIssueFocusOriginRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    preloadNewIssueDialog();
    openNewIssueDialog();
  }, [openNewIssueDialog]);
  const toggleAskAi = useAskAiStore((state) => state.toggle);
  const toggleGlobalSearch = useGlobalSearchStore((state) => state.toggle);
  const globalSearchOpen = useGlobalSearchStore((state) => state.isOpen);
  const toggleShortcuts = useShortcutsStore((state) => state.toggle);
  const shortcutsOpen = useShortcutsStore((state) => state.isOpen);
  const newIssueDialogMounted = useMountAfterOpen(newIssueDialogOpen);
  const createWorkspaceDialogMounted = useMountAfterOpen(
    createWorkspaceDialogOpen,
  );
  const globalSearchDialogMounted = useMountAfterOpen(globalSearchOpen);
  const keyboardShortcutsDialogMounted = useMountAfterOpen(shortcutsOpen);
  const toggleGlobalSearchWithPreload = useCallback(() => {
    if (!useGlobalSearchStore.getState().isOpen) {
      preloadGlobalSearchDialog();
    }
    toggleGlobalSearch();
  }, [toggleGlobalSearch]);
  const toggleShortcutsWithPreload = useCallback(() => {
    if (!useShortcutsStore.getState().isOpen) {
      preloadKeyboardShortcutsDialog();
    }
    toggleShortcuts();
  }, [toggleShortcuts]);
  const moveIssueFocus = useIssueKeyboardStore((state) => state.moveFocus);
  const requestQuickEdit = useIssueKeyboardStore(
    (state) => state.requestQuickEdit,
  );
  const selectionActive = useIssueSelectionStore(
    (state) => state.selectedIds.size > 0,
  );
  const clearIssueSelection = useIssueSelectionStore((state) => state.clear);
  // Singleton locale side-effects (one-time hydrate + cookie/lang reconcile),
  // mounted in the authenticated shell. Restores a persisted locale if the
  // cookie was cleared (REEF-291).
  useLocaleSync();
  const t = useTranslations("nav");
  const activeLocale = useLocale();
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

  // The active vault scopes the shared config and retained workspace surfaces.
  const { vault } = useActiveVault();

  // Prime the `['config', vault]` query cache for the active vault. Other
  // features (NewIssueDialog, AskAiDialog, enrichment) call `ensureProjectConfig`
  // against the same cache key and dedupe to this fetch instead of issuing
  // their own.
  useProjectConfig(vault);
  // Inbox unread state is an account-scoped persisted notification list. The
  // hook reads the bounded unread list itself; there is deliberately no count
  // endpoint and no browser visit marker in this path.
  const unreadNotificationCount = useUnreadNotificationCount(vault);

  // My Work "needs attention" count for its sidebar badge (REEF-204): the
  // signed-in user's overdue + due-soon work, derived from MyWorkPage's same
  // `useIssueList` cache (no extra fetch). Hidden while on /my-work.
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

  // Resolve the badge a nav link shows, if any.
  function navBadgeFor(href: string, isActive: boolean): NavBadge | null {
    if (href === "/inbox" && unreadNotificationCount > 0) {
      return {
        kind: "count",
        display: cap(unreadNotificationCount),
        label:
          unreadNotificationCount >= 100
            ? t("badge.unreadNotificationsAtLeast100")
            : t("badge.unreadNotifications", {
                count: unreadNotificationCount,
              }),
        tone: "brand",
        badgeTestId: "inbox-unread-badge",
        dotTestId: "inbox-unread-dot",
      };
    }
    if (isActive) return null;
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
  const commandDestinationRef = useRef<HTMLElement>(null);
  const commandDestinationFocusPendingRef = useRef(false);
  const commandDestinationFocusPathRef = useRef<string | null>(null);
  const commandDestinationFocusLocaleRef = useRef<string | null>(null);

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

  const resolveShortcutScope = useCallback((): ShortcutScope => {
    if (typeof window === "undefined") return "global";
    const path = window.location.pathname;
    if (!path.includes("/issues")) return "global";
    if (/\/issues\/[^/]+/.test(path)) return "detail";
    const { scope, layout } = parseIssueViewState(
      new URLSearchParams(window.location.search),
    );
    if (layout === "list") return scope === "backlog" ? "backlog" : "list";
    if (layout === "board") return "board";
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
      requestQuickEdit(scope, field, { requestDomFocus: false });
    },
    [requestQuickEdit, selectionActive],
  );

  const focusCommandDestination = useCallback(() => {
    commandDestinationFocusPendingRef.current = true;
    commandDestinationFocusPathRef.current = pathname;
    commandDestinationFocusLocaleRef.current = activeLocale;
    document.documentElement.setAttribute(COMMAND_FOCUS_PENDING_ATTRIBUTE, "");
    commandDestinationRef.current?.focus({ preventScroll: true });
  }, [activeLocale, pathname]);

  // Radix closes the palette before the App Router finishes a soft navigation.
  // A synchronous focus handoff is therefore vulnerable to the router's route
  // commit moving focus back to the document body. Keep a marker outside the
  // route subtree so a remounted shell can finish the handoff after the route
  // settles; route commits and locale refreshes reuse the same effect through
  // pathname and activeLocale.
  useEffect(() => {
    if (!activeLocale) return;
    if (
      !commandDestinationFocusPendingRef.current &&
      !document.documentElement.hasAttribute(COMMAND_FOCUS_PENDING_ATTRIBUTE)
    ) {
      return;
    }
    const routeSettled = commandDestinationFocusPathRef.current !== pathname;
    const localeSettled =
      commandDestinationFocusLocaleRef.current !== activeLocale;
    if (!routeSettled && !localeSettled) return;
    const frame = window.requestAnimationFrame(() => {
      if (
        !commandDestinationFocusPendingRef.current &&
        !document.documentElement.hasAttribute(COMMAND_FOCUS_PENDING_ATTRIBUTE)
      ) {
        return;
      }
      commandDestinationFocusPendingRef.current = false;
      commandDestinationFocusPathRef.current = null;
      commandDestinationFocusLocaleRef.current = null;
      document.documentElement.removeAttribute(COMMAND_FOCUS_PENDING_ATTRIBUTE);
      commandDestinationRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeLocale, pathname]);

  const commandRegistry = useCommandRegistry({
    vault: vault ?? "",
    togglePalette: toggleGlobalSearchWithPreload,
    toggleShortcuts: toggleShortcutsWithPreload,
    openNewIssue: openBlankNewIssueDialog,
    toggleAskAi,
    startChord,
    clearChord,
    focusDestination: focusCommandDestination,
    clearSelection: clearIssueSelection,
    moveIssueFocus,
    openFocusedIssue,
    editFocusedIssue,
  });
  const shortcutRegistry = commandRegistry.shortcutBindings;

  const closeUnreadyLazySurfaces = useCallback(
    (event: KeyboardEvent): boolean => {
      if (event.key !== "Escape" || event.defaultPrevented) return false;

      const surfaces: ReadonlyArray<{
        open: boolean;
        selector: string;
        close: () => void;
      }> = [
        {
          open: useViewStore.getState().newIssueDialogOpen,
          selector: '[data-testid="new-issue-dialog"]',
          close: useViewStore.getState().closeNewIssueDialog,
        },
        {
          open: useViewStore.getState().createWorkspaceDialogOpen,
          selector: '[data-testid="create-workspace-dialog"]',
          close: useViewStore.getState().closeCreateWorkspaceDialog,
        },
        {
          open: useGlobalSearchStore.getState().isOpen,
          selector: '[data-testid="global-search-input"]',
          close: useGlobalSearchStore.getState().close,
        },
        {
          open: useShortcutsStore.getState().isOpen,
          selector: '[data-testid="keyboard-shortcuts-dialog"]',
          close: useShortcutsStore.getState().close,
        },
        {
          open: useAskAiStore.getState().isOpen,
          selector: '[data-testid="ask-ai-dialog"]',
          close: useAskAiStore.getState().close,
        },
        {
          open: commandRegistry.pendingClose !== null,
          selector: '[data-testid="close-issue-dialog"]',
          close: () => commandRegistry.setPendingClose(null),
        },
      ];

      let closed = false;
      for (const surface of surfaces) {
        if (surface.open && !document.querySelector(surface.selector)) {
          surface.close();
          closed = true;
        }
      }
      if (closed) event.preventDefault();
      return closed;
    },
    [commandRegistry.pendingClose, commandRegistry.setPendingClose],
  );

  // Global shortcut dispatcher. Bindings are declared above with scope +
  // key contracts; this stays the shell's single keydown listener.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (closeUnreadyLazySurfaces(e)) return;
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
  }, [
    clearChord,
    closeUnreadyLazySurfaces,
    resolveShortcutScope,
    shortcutRegistry,
  ]);

  return (
    <div
      className={cn(
        "flex h-screen overflow-hidden bg-surface-page",
        // Server-rendered controls look ready before React has attached their
        // handlers. Keep the shell out of the visible interaction surface for
        // that brief window so early pointer and keyboard input is not silently
        // discarded.
        !interactionReady && "invisible",
      )}
      aria-busy={!interactionReady}
      aria-hidden={!interactionReady}
      data-interaction-ready={interactionReady}
    >
      {/* Sidebar */}
      <aside
        className={cn(
          SIDEBAR_ASIDE_CLASS,
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
            SIDEBAR_BRAND_HEADER_CLASS,
            sidebarCollapsed ? "justify-center px-0" : "justify-between px-3",
          )}
        >
          {sidebarCollapsed ? (
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={t("expandSidebar")}
              title={t("expandSidebar")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
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
                  className="type-group-title text-foreground"
                  data-testid="sidebar-brand-name"
                >
                  reef{/* i18n-exempt: brand name */}
                </span>
              </div>
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label={t("collapseSidebar")}
                className={SIDEBAR_TOGGLE_CLASS}
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
            onMouseEnter={preloadNewIssueDialog}
            onFocus={preloadNewIssueDialog}
            data-testid="new-issue-trigger"
            aria-label={newIssueLabel}
            title={newIssueLabel}
            className={cn("w-full text-center", sidebarCollapsed && "px-0")}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            {!sidebarCollapsed && <span>{t("newIssue")}</span>}
          </Button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-2 py-3" aria-label={t("mainNavLandmark")}>
          <ul className="flex flex-col gap-0.5">
            {SIDEBAR_NAV_ITEMS.map(({ href, labelKey, testId, icon: Icon }) => {
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
                      className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand-fill"
                      aria-hidden="true"
                    />
                  )}
                  <Link
                    href={fullHref}
                    title={sidebarCollapsed ? label : undefined}
                    aria-label={badge ? `${label} ${badge.label}` : label}
                    data-testid={`sidebar-nav-${testId}`}
                    className={cn(
                      SIDEBAR_NAV_LINK_CLASS,
                      isActive
                        ? SIDEBAR_NAV_ACTIVE_CLASS
                        : SIDEBAR_NAV_INACTIVE_CLASS,
                      sidebarCollapsed && SIDEBAR_NAV_COLLAPSED_CLASS,
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
                          <output
                            data-testid={badge.dotTestId}
                            className={cn(
                              "absolute right-1 top-1 h-1.5 w-1.5 rounded-full",
                              NAV_BADGE_DOT[badge.tone],
                            )}
                            aria-live="polite"
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
                            <output
                              data-testid={badge.badgeTestId}
                              aria-live="polite"
                              aria-label={badge.label}
                              className={cn(
                                "ml-auto inline-block h-1.5 w-1.5 rounded-full",
                                NAV_BADGE_DOT[badge.tone],
                              )}
                            />
                          ) : (
                            <output
                              data-testid={badge.badgeTestId}
                              aria-live="polite"
                              aria-label={badge.label}
                              className={cn(
                                "ml-auto inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 type-card-metadata font-semibold leading-none tabular-nums",
                                NAV_BADGE_PILL[badge.tone],
                              )}
                            >
                              {badge.display}
                            </output>
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
        <SidebarFooterShortcuts
          collapsed={sidebarCollapsed}
          onPreload={preloadKeyboardShortcutsDialog}
        />
        <SidebarWorkspace
          collapsed={sidebarCollapsed}
          onPreload={preloadCreateWorkspaceDialog}
        />
        <SidebarAccount appVersion={appVersion} collapsed={sidebarCollapsed} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <OfflineBanner />
        <main
          ref={commandDestinationRef}
          tabIndex={-1}
          data-command-focus-destination=""
          className="min-w-0 flex-1 overflow-auto bg-surface-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus"
        >
          {children}
        </main>
      </div>

      {/* Global new-issue dialog — single instance for the whole shell so any
          trigger (sidebar button, keyboard shortcut, future quick-add) shares
          state. */}
      {newIssueDialogMounted ? (
        <NewIssueDialog focusOriginRef={newIssueFocusOriginRef} />
      ) : null}

      {/* Global create-workspace dialog (REEF-146) — single instance opened
          from the sidebar workspace switcher (and later Settings, REEF-147). */}
      {createWorkspaceDialogMounted ? <CreateWorkspaceDialog /> : null}

      {/* Global ⌘K search palette. Mounted on first intent and retained after
          that point so its close-focus handoff remains owned by Radix; its
          search queries are disabled while closed. */}
      {globalSearchDialogMounted ? (
        <GlobalSearchDialog registry={commandRegistry} />
      ) : null}

      {commandRegistry.pendingClose ? (
        <CloseIssueDialog
          open
          issueId={commandRegistry.pendingClose.issueId}
          disabled={commandRegistry.mutationPending}
          onOpenChange={(open) => {
            if (!open) commandRegistry.setPendingClose(null);
          }}
          onConfirm={commandRegistry.confirmPendingClose}
        />
      ) : null}

      {/* Keyboard shortcuts cheat sheet (⌘?). Mounted on first intent and
          retained after that point; the keybinding and the sidebar utility
          button share one store. */}
      {keyboardShortcutsDialogMounted ? <KeyboardShortcutsDialog /> : null}

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
