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
      <div className="flex flex-1 overflow-hidden" aria-hidden="true">
        <aside className="flex w-60 shrink-0 flex-col gap-4 border-r border-border-subtle bg-sidebar p-3">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-9 w-full" />
          <div className="flex flex-col gap-1.5 pt-1">
            {["a", "b", "c", "d", "e"].map((key) => (
              <Skeleton key={key} className="h-8 w-full" />
            ))}
          </div>
        </aside>

        <BoardColumnsSkeleton className="flex-1 overflow-hidden" />
      </div>
    </div>
  );
}
