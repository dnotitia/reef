import { BoardColumnsSkeleton } from "@/components/BoardColumnsSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "next-intl";

/**
 * First-paint shell shown while the root route resolves its session/workspace
 * redirect. Mirrors the dashboard's sidebar + board frame so the initial paint
 * reads as "loading the board" instead of a bare centered "Loading…" — the
 * board is the most common post-redirect destination for a returning user.
 *
 * The visual skeleton is decorative (aria-hidden); a sibling sr
 * `role="status"` carries the loading announcement so assistive technology
 * still hears a loading state during a slow redirect instead of a blank page.
 * (REEF-097 AC2)
 */
export function AppShellSkeleton() {
  const c = useTranslations("common");
  return (
    <div
      className="flex h-screen overflow-hidden bg-background"
      data-testid="app-shell-skeleton"
    >
      <output className="sr-only">{c("loading")}</output>

      {/* Decorative shell — sidebar rail + board column frame. */}
      <div className="flex min-w-0 flex-1 overflow-hidden" aria-hidden="true">
        <aside
          data-testid="app-shell-skeleton-sidebar"
          className="flex w-14 shrink-0 flex-col gap-4 border-r border-border-subtle bg-sidebar p-3 md:w-60"
        >
          <Skeleton className="size-8 md:h-8 md:w-28" />
          <Skeleton className="h-9 w-full" />
          <div className="flex flex-col gap-1.5 pt-1">
            {["a", "b", "c", "d", "e"].map((key) => (
              <Skeleton key={key} className="h-8 w-full" />
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main
            data-testid="app-shell-skeleton-main"
            className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            <BoardColumnsSkeleton />
          </main>
        </div>
      </div>
    </div>
  );
}
