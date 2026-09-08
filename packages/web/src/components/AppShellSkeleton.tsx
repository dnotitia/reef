import { BoardColumnsSkeleton } from "@/components/BoardColumnsSkeleton";
import {
  SIDEBAR_ASIDE_CLASS,
  SIDEBAR_BRAND_HEADER_CLASS,
  SIDEBAR_NAV_ACTIVE_CLASS,
  SIDEBAR_NAV_INACTIVE_CLASS,
  SIDEBAR_NAV_ITEMS,
  SIDEBAR_NAV_LINK_CLASS,
  SIDEBAR_TOGGLE_CLASS,
} from "@/components/sidebarChrome";
import { Button } from "@/components/ui/button";
import { ReefMark } from "@/components/ui/reef-mark";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

type SidebarNavKey = (typeof SIDEBAR_NAV_ITEMS)[number]["labelKey"];

/**
 * First-paint shell shown while the root route resolves its session/workspace
 * redirect. Mirrors the dashboard's sidebar + board frame so the initial paint
 * reads as "loading the board" instead of a bare centered "Loading…" — the
 * board is the most common post-redirect destination for a returning user.
 *
 * The default board's placeholder bars are decorative (aria-hidden), while its
 * fixed column labels remain available to assistive technology. A sibling sr
 * `role="status"` carries the loading announcement so assistive technology
 * still hears a loading state during a slow redirect instead of a blank page.
 * Auth-pending destination content may supply its own static labels and single
 * loading announcement in the main slot. (REEF-097 AC2)
 */
export function AppShellSkeleton({
  content,
  announce = true,
  activeNav,
  sidebarCollapsed = false,
}: {
  /** Static, non-interactive destination chrome for an auth-pending route. */
  content?: ReactNode;
  /** Route content owns the single loading announcement when supplied. */
  announce?: boolean;
  /** URL-resolved active destination, when the auth-pending route is known. */
  activeNav?: SidebarNavKey;
  /** Preserve the mounted dashboard's desktop sidebar width during pending auth. */
  sidebarCollapsed?: boolean;
} = {}) {
  const c = useTranslations("common");
  const nav = useTranslations("nav");
  return (
    <div
      className="flex h-screen overflow-hidden bg-surface-page"
      aria-busy="true"
      data-testid="app-shell-skeleton"
    >
      {announce && <output className="sr-only">{c("loading")}</output>}

      {/* Static shell chrome stays readable while the auth/workspace gate is
          pending. It uses the same mark, button, navigation, and typography
          classes as DashboardShell, but remains inert before hydration. */}
      <aside
        data-testid="app-shell-skeleton-sidebar"
        aria-label={nav("sidebarLandmark")}
        className={cn(
          SIDEBAR_ASIDE_CLASS,
          sidebarCollapsed ? "w-14" : "w-14 md:w-60",
        )}
      >
        <div
          className={cn(
            SIDEBAR_BRAND_HEADER_CLASS,
            sidebarCollapsed
              ? "justify-center px-0"
              : "justify-center px-0 md:justify-between md:px-3",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <ReefMark
              className="size-6 text-center"
              decorative
              data-testid="sidebar-brand-mark"
            />
            {!sidebarCollapsed && (
              <span
                className="sr-only md:not-sr-only md:truncate type-group-title text-foreground"
                data-testid="sidebar-brand-name"
              >
                reef{/* i18n-exempt: brand name */}
              </span>
            )}
          </div>
          {!sidebarCollapsed && (
            <span
              className={cn("sr-only md:not-sr-only", SIDEBAR_TOGGLE_CLASS)}
              aria-hidden="true"
            >
              <ChevronLeft className="h-4 w-4" />
            </span>
          )}
        </div>
        <div
          className={cn("pt-3", sidebarCollapsed ? "px-1.5" : "px-1.5 md:px-2")}
        >
          <Button
            asChild
            size="sm"
            className="w-full px-0 text-center md:px-2.5"
          >
            <span
              data-testid="new-issue-trigger"
              aria-label={nav("newIssue")}
              title={nav("newIssue")}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              {!sidebarCollapsed && (
                <span className="sr-only md:not-sr-only">
                  {nav("newIssue")}
                </span>
              )}
            </span>
          </Button>
        </div>
        <nav className="flex-1 px-2 py-3" aria-label={nav("mainNavLandmark")}>
          <ul className="flex flex-col gap-0.5">
            {SIDEBAR_NAV_ITEMS.map(({ labelKey, testId, icon: Icon }) => {
              const isActive = labelKey === activeNav;
              return (
                <li key={labelKey} className="relative">
                  {isActive && (
                    <span
                      className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand-fill"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    data-testid={`sidebar-nav-${testId}`}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      SIDEBAR_NAV_LINK_CLASS,
                      isActive
                        ? SIDEBAR_NAV_ACTIVE_CLASS
                        : SIDEBAR_NAV_INACTIVE_CLASS,
                      "cursor-default",
                      sidebarCollapsed
                        ? "h-9 justify-center px-0"
                        : "h-9 justify-center px-0 md:h-auto md:justify-start md:px-3",
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      className="h-[18px] w-[18px] shrink-0 stroke-[1.9]"
                    />
                    {!sidebarCollapsed && (
                      <span className="sr-only md:not-sr-only flex-1">
                        {nav(labelKey)}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main
          data-testid="app-shell-skeleton-main"
          className="min-w-0 flex-1 overflow-auto bg-surface-page"
        >
          {content ?? (
            <div className="flex min-h-0 min-w-0 h-full">
              <BoardColumnsSkeleton />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
