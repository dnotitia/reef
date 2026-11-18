import {
  SIDEBAR_ASIDE_CLASS,
  SIDEBAR_BRAND_HEADER_CLASS,
  SIDEBAR_NAV_ACTIVE_CLASS,
  type SIDEBAR_NAV_ITEMS,
  SIDEBAR_PERSONAL_NAV_ITEMS,
  SIDEBAR_NAV_LINK_CLASS,
  SIDEBAR_WORKSPACE_NAV_ITEMS,
} from "@/components/sidebarChrome";
import { Button } from "@/components/ui/button";
import { ReefMark } from "@/components/ui/reef-mark";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronsUpDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

type SidebarNavKey = (typeof SIDEBAR_NAV_ITEMS)[number]["labelKey"];

export function AppShellSkeleton({
  content,
  announce = true,
  activeNav,
  sidebarCollapsed = false,
}: {
  /** Static, non-interactive destination chrome for an auth-pending route. */
  content: ReactNode;
  /** Route content owns the single loading announcement when supplied. */
  announce?: boolean;
  /** URL-resolved active destination, when the auth-pending route is known. */
  activeNav?: SidebarNavKey;
  /** Preserve the mounted dashboard's desktop sidebar width during pending auth. */
  sidebarCollapsed?: boolean;
}) {
  const c = useTranslations("common");
  const nav = useTranslations("nav");
  return (
    <div
      className="flex h-screen overflow-hidden bg-surface-page"
      aria-busy="true"
      data-testid="app-shell-skeleton"
    >
      {announce && <output className="sr-only">{c("loading")}</output>}

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
              className="sr-only h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-50 md:not-sr-only md:inline-flex"
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
            type="button"
            disabled
            size="sm"
            data-testid="new-issue-trigger"
            aria-label={nav("newIssue")}
            title={nav("newIssue")}
            className={cn(
              "w-full text-center",
              sidebarCollapsed ? "px-0" : "px-0 md:px-2.5",
            )}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            {!sidebarCollapsed && (
              <span
                className={cn("sr-only", !sidebarCollapsed && "md:not-sr-only")}
              >
                {nav("newIssue")}
              </span>
            )}
          </Button>
        </div>
        <nav
          className="flex-1 overflow-y-auto px-2 py-3"
          aria-label={nav("mainNavLandmark")}
        >
          {[
            {
              id: "personal",
              label: nav("personal"),
              items: SIDEBAR_PERSONAL_NAV_ITEMS,
            },
            {
              id: "workspace",
              label: nav("workspaceSection"),
              items: SIDEBAR_WORKSPACE_NAV_ITEMS,
            },
          ].map(({ id, label, items }) => (
            <section
              key={id}
              data-testid={`sidebar-${id}-group`}
              className={
                id === "workspace"
                  ? "mt-2 border-t border-border-subtle pt-2"
                  : undefined
              }
            >
              <h2
                className={cn(
                  "px-3 pb-1 type-card-metadata font-medium uppercase tracking-wide text-muted-foreground",
                  sidebarCollapsed && "sr-only",
                )}
              >
                {label}
              </h2>
              {id === "workspace" && (
                <div
                  data-testid="sidebar-workspace-placeholder"
                  aria-hidden="true"
                  className={cn("py-1", sidebarCollapsed && "-mx-0.5")}
                >
                  <div
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 rounded-md",
                      sidebarCollapsed
                        ? "justify-center px-0 py-1"
                        : "px-3 py-1.5",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 rounded-md bg-surface-elevated ring-1 ring-border",
                        sidebarCollapsed ? "size-9" : "size-7",
                      )}
                    />
                    {!sidebarCollapsed && (
                      <span className="flex min-w-0 flex-1 items-center">
                        <span className="h-3.5 w-24 rounded-sm bg-surface-hover" />
                      </span>
                    )}
                    {!sidebarCollapsed && (
                      <ChevronsUpDown
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    )}
                  </div>
                </div>
              )}
              <ul className="flex flex-col gap-0.5">
                {items.map(({ labelKey, testId, icon: Icon }) => {
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
                        aria-disabled="true"
                        className={cn(
                          SIDEBAR_NAV_LINK_CLASS,
                          isActive
                            ? SIDEBAR_NAV_ACTIVE_CLASS
                            : "text-muted-foreground",
                          "cursor-default opacity-50",
                          sidebarCollapsed
                            ? "h-9 justify-center px-0"
                            : "h-9 justify-center px-0 md:h-auto md:justify-start md:px-3",
                        )}
                      >
                        <Icon
                          aria-hidden="true"
                          className={cn(
                            "h-[18px] w-[18px] shrink-0 stroke-[1.9]",
                            !sidebarCollapsed && "md:hidden",
                          )}
                        />
                        {!sidebarCollapsed && (
                          <span
                            className={cn(
                              "sr-only",
                              !sidebarCollapsed && "md:not-sr-only flex-1",
                            )}
                          >
                            {nav(labelKey)}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main
          data-testid="app-shell-skeleton-main"
          className="min-w-0 flex-1 overflow-auto bg-surface-page"
        >
          {content}
        </main>
      </div>
    </div>
  );
}
