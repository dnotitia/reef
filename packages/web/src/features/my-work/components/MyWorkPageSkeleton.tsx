"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { useDueLabels, useStatusLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { Status } from "@reef/core";
import { useTranslations } from "next-intl";

const STAGE_LEGEND_KEYS = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
] as const satisfies readonly Status[];
const QUEUE_ROW_KEYS = ["r0", "r1", "r2", "r3", "r4", "r5"] as const;

function LabeledSkeleton({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <div className={cn("relative inline-flex min-w-0", className)}>
      <Skeleton
        aria-hidden="true"
        tone="secondary"
        className={cn("absolute inset-0", className)}
      />
      <span className="relative z-[1] min-w-0 truncate px-1 type-card-metadata text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

/**
 * Body skeleton for My Work: the summary section (stat tiles over a status
 * StageBar) and the focus queue (its header + the bordered row list). Shared by
 * {@link MyWorkPage}'s in-flight branches and the full-page
 * {@link MyWorkPageSkeleton} so the route fallback and the data-loading state
 * render the same placeholder (REEF-255).
 *
 * It mirrors {@link MyWorkSummary} and {@link MyWorkQueue} structurally so the
 * body does not shift when the real content hydrates (REEF-258): the StageBar
 * card and the queue header (title + count + the By priority/By status toggle)
 * each get a placeholder they were missing, the queue rows sit in the same
 * borderless-divider container the real rows do (not a padded `gap-2` box), and
 * the tile count follows `hasSprint` — the loaded grid is `sm:grid-cols-4` with
 * a sprint tile, `sm:grid-cols-3` without — instead of a hard-coded four.
 */
export function MyWorkSkeleton({ hasSprint = false }: { hasSprint?: boolean }) {
  const c = useTranslations("common");
  const t = useTranslations("myWork");
  const dueLabels = useDueLabels();
  const statusLabels = useStatusLabels();
  const tileKeys = hasSprint
    ? ["wip", "due", "overdue", "sprint"]
    : ["wip", "due", "overdue"];
  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="my-work-skeleton">
      {/* Single per-surface loading announcement (REEF-281). It lives on the
          body-level leaf so the full-page MyWorkPageSkeleton (and MyWorkPage's
          in-flight branches) inherit exactly one — not a doubled notification.
          Sibling to the placeholder bars, so it is not hidden. */}
      <output className="sr-only">{c("loading")}</output>
      {/* Placeholder bars are decorative and hidden individually; fixed stat,
          stage, and queue labels remain in the accessibility tree. */}
      <div className="flex flex-col gap-6">
        {/* Summary: stat tiles + status StageBar (mirrors MyWorkSummary). */}
        <section className="flex flex-col gap-3">
          <ul
            className={cn(
              "grid grid-cols-2 gap-3",
              hasSprint ? "sm:grid-cols-4" : "sm:grid-cols-3",
            )}
          >
            {tileKeys.map((key) => (
              <li
                key={key}
                className="flex min-h-[78px] flex-col justify-between gap-1 rounded-lg border border-border-subtle bg-surface-subtle p-3"
              >
                {key === "wip" ? (
                  <LabeledSkeleton
                    label={t("inProgress")}
                    className="h-3 w-20"
                  />
                ) : key === "due" ? (
                  <LabeledSkeleton
                    label={dueLabels.due_soon}
                    className="h-3 w-20"
                  />
                ) : key === "overdue" ? (
                  <LabeledSkeleton
                    label={dueLabels.overdue}
                    className="h-3 w-20"
                  />
                ) : (
                  <Skeleton
                    aria-hidden="true"
                    tone="secondary"
                    className="h-3 w-16"
                  />
                )}
                <Skeleton aria-hidden="true" className="h-6 w-10" />
              </li>
            ))}
          </ul>
          {/* StageBar: caption + distribution bar + per-stage legend. */}
          <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-subtle p-3">
            <LabeledSkeleton
              label={t("openWorkByStage")}
              className="h-3 w-32"
            />
            <Skeleton aria-hidden="true" className="h-2 w-full rounded-full" />
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {STAGE_LEGEND_KEYS.map((key) => (
                <LabeledSkeleton
                  key={key}
                  label={statusLabels[key]}
                  className="h-3 w-20"
                />
              ))}
            </div>
          </div>
        </section>

        {/* Queue: header (title + count + group toggle) + the bordered row list
          (mirrors MyWorkQueue). */}
        <section className="flex flex-col gap-3">
          <header className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <LabeledSkeleton label={t("queueTitle")} className="h-4 w-32" />
              <Skeleton
                aria-hidden="true"
                tone="secondary"
                className="h-3 w-6"
              />
            </div>
            <LabeledSkeleton
              label={`${t("byPriority")} · ${t("byStatus")}`}
              className="h-8 w-40"
            />
          </header>
          <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-page">
            {QUEUE_ROW_KEYS.map((key) => (
              <div
                key={key}
                className="border-t border-border-subtle px-3 py-2 first:border-t-0"
              >
                <Skeleton aria-hidden="true" className="h-5 w-full" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Full-page My Work skeleton — the page chrome (header + body region) around the
 * {@link MyWorkSkeleton}. Used by the route's `loading.tsx` (soft-nav) and the
 * page's `<Suspense fallback>` (the `useSearchParams` CSR bail-out on a hard
 * navigation), so neither path paints a blank body before hydration (REEF-255).
 * It is unable to know the sprint state before data, so it defaults to the no-sprint
 * three-tile layout (the baseline); the page passes the resolved sprint state
 * to {@link MyWorkSkeleton} once the planning catalog is in.
 */
export function MyWorkPageSkeleton() {
  const nav = useTranslations("nav");
  return (
    <div className="flex h-full min-w-0 flex-col">
      <PageHeader title={nav("myWork")} />
      <PageBody width="wide" className="flex flex-col gap-6">
        <MyWorkSkeleton />
      </PageBody>
    </div>
  );
}
