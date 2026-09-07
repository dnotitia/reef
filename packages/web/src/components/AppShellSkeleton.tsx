import { BoardColumnsSkeleton } from "@/components/BoardColumnsSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

const NAV_ITEMS = [
  "issues",
  "myWork",
  "inbox",
  "planning",
  "reports",
  "settings",
] as const;

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
}: {
  /** Static, non-interactive destination chrome for an auth-pending route. */
  content?: ReactNode;
  /** Route content owns the single loading announcement when supplied. */
  announce?: boolean;
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
          pending. There are no links or handlers here, so it cannot be used
          before hydration; only the placeholder shapes are decorative. */}
      <div className="flex min-w-0 flex-1 overflow-hidden">
        <aside
          data-testid="app-shell-skeleton-sidebar"
          aria-label={nav("sidebarLandmark")}
          className="flex w-14 shrink-0 flex-col gap-4 border-r border-border-subtle bg-surface-sidebar p-3 md:w-60"
        >
          <div className="relative">
            <Skeleton aria-hidden="true" className="size-8 md:h-8 md:w-28" />
            <span className="sr-only md:not-sr-only md:absolute md:inset-0 md:flex md:items-center md:px-2 type-group-title text-foreground">
              reef{/* i18n-exempt: brand name */}
            </span>
          </div>
          <div className="relative">
            <Skeleton aria-hidden="true" className="h-9 w-full" />
            <span className="sr-only md:not-sr-only md:absolute md:inset-0 md:flex md:items-center md:justify-center md:truncate md:px-2 type-small-button font-medium text-foreground">
              {nav("newIssue")}
            </span>
          </div>
          <nav
            className="-mx-3 flex-1 px-2"
            aria-label={nav("mainNavLandmark")}
          >
            <ul className="flex flex-col gap-1.5 pt-1">
              {NAV_ITEMS.map((key) => (
                <li key={key} className="relative">
                  <Skeleton aria-hidden="true" className="h-8 w-full" />
                  <span className="sr-only md:not-sr-only md:absolute md:inset-0 md:flex md:items-center md:truncate md:px-3 type-navigation text-muted-foreground">
                    {nav(key)}
                  </span>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main
            data-testid="app-shell-skeleton-main"
            className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            {content ?? (
              <div className="flex min-h-0 min-w-0 flex-1">
                <BoardColumnsSkeleton />
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
