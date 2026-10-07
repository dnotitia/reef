import { Skeleton } from "@/components/ui/skeleton";
import { useLocale, useTranslations } from "next-intl";

/**
 * Reserves the responsive frame occupied by a visible rollover nudge while a
 * protected surface is waiting for auth. The catalog and issue data are
 * intentionally unavailable in that state, so this inert placeholder keeps
 * the fixed content frame from jumping when the nudge resolves.
 */
export function SprintRolloverPendingSkeleton({
  priority = "primary",
  sprintName,
}: {
  priority?: "primary" | "secondary";
  sprintName?: string;
}) {
  const locale = useLocale();
  const t = useTranslations("planning.rollover");
  const secondary = priority === "secondary";

  return (
    <div
      data-testid="sprint-rollover-pending-skeleton"
      aria-hidden="true"
      className={`mb-3 flex min-w-0 shrink-0 flex-col gap-2 border-b border-border-subtle py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
        secondary ? "bg-surface-page" : "bg-surface-subtle/60"
      }`}
    >
      <div className="min-w-0 flex-1">
        {sprintName ? (
          <p
            className={`type-control font-medium text-foreground [overflow-wrap:anywhere] ${
              locale === "ko" ? "[word-break:keep-all]" : ""
            }`}
          >
            {t("nudgeTitle", { name: sprintName })}
          </p>
        ) : (
          <Skeleton className="h-5 w-3/4 max-w-64" />
        )}
        <div className="mt-0.5 flex flex-col">
          <Skeleton className="h-4 w-full max-w-80" />
          {locale === "ko" ? (
            <Skeleton className="h-4 w-3/4 max-w-64 sm:hidden" />
          ) : null}
        </div>
      </div>
      <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
        <Skeleton className="h-7 w-28 shrink-0 [@media(pointer:coarse)]:h-11" />
        <Skeleton className="h-7 w-7 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" />
      </div>
    </div>
  );
}
