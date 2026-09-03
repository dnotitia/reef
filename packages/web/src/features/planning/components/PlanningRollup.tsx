"use client";

import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import type { PlanningRollup as PlanningRollupData } from "@reef/core";
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import type { PlanningItem, PlanningKind } from "../hooks/usePlanningCatalog";

export type IssueAggregationState = "loading" | "unavailable" | "available";

const ISSUE_FILTER_KEY: Record<
  PlanningKind,
  "sprint_id" | "milestone_id" | "release_id"
> = {
  sprints: "sprint_id",
  milestones: "milestone_id",
  releases: "release_id",
};

const STATUS_SEGMENTS = [
  { key: "completed", className: "bg-status-done-chart" },
  { key: "inProgress", className: "bg-status-in-progress-chart" },
  { key: "notStarted", className: "bg-status-open-chart" },
] as const;

function formatNumber(locale: string, value: number): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  }).format(value);
}

function issuesHref(vault: string, kind: PlanningKind, id: string): string {
  const params = new URLSearchParams();
  params.set(ISSUE_FILTER_KEY[kind], id);
  return withVault(vault, `/issues?${params.toString()}`);
}

function segmentWidth(count: number, total: number): string {
  return total > 0 ? `${(count / total) * 100}%` : "0%";
}

export function PlanningRollup({
  vault,
  kind,
  item,
  rollup,
  state,
}: {
  vault: string;
  kind: PlanningKind;
  item: PlanningItem;
  rollup: PlanningRollupData | undefined;
  state: IssueAggregationState;
}) {
  const t = useTranslations("planning");
  const locale = useLocale();
  const descriptionId = useId();

  if (state !== "available" || !rollup) {
    return (
      <span
        data-testid={`planning-rollup-${item.id}`}
        role="status"
        className="text-sm text-muted-foreground"
      >
        {state === "loading" ? t("issuesLoading") : t("issuesUnavailable")}
      </span>
    );
  }

  const number = (value: number) => formatNumber(locale, value);
  const completion =
    rollup.completionRate === null
      ? t("rollupNoCompletionRate")
      : t("rollupCompletionRate", {
          rate: Math.round(rollup.completionRate * 100),
        });
  const remainingCapacity = rollup.remainingCapacityPoints;
  const capacityStatus =
    rollup.capacityPoints === null || remainingCapacity === null
      ? t("rollupCapacityNotSet")
      : remainingCapacity === 0
        ? t("rollupCapacityAtLimit")
        : remainingCapacity > 0
          ? t("rollupCapacityRemaining", {
              points: number(remainingCapacity),
            })
          : t("rollupCapacityOver", {
              points: number(-remainingCapacity),
            });
  const capacityParts =
    kind === "sprints"
      ? [
          t("rollupAssignedPoints", {
            points: number(rollup.estimatedPoints),
          }),
          rollup.capacityPoints === null
            ? t("rollupCapacityNotSet")
            : t("rollupCapacityPoints", {
                points: number(rollup.capacityPoints),
              }),
          ...(rollup.capacityPoints === null ? [] : [capacityStatus]),
        ]
      : [];
  const capacitySummary = capacityParts.join(" · ");
  const capacity =
    capacityParts.length > 0 ? (
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-muted-foreground">
        {capacityParts.map((part, index) => (
          <span key={`${part}-${index}`}>{part}</span>
        ))}
      </div>
    ) : null;
  const pointSummary = t("rollupPoints", {
    estimated: number(rollup.estimatedPoints),
    completed: number(rollup.completedPoints),
  });
  const statusSummary = t("rollupStatusSummary", {
    completed: number(rollup.completed),
    inProgress: number(rollup.inProgress),
    notStarted: number(rollup.notStarted),
  });
  const description = [
    statusSummary,
    completion,
    pointSummary,
    rollup.unestimatedCount > 0
      ? t("rollupUnestimated", { count: number(rollup.unestimatedCount) })
      : null,
    capacitySummary,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  return (
    <a
      data-testid={`planning-rollup-${item.id}`}
      href={issuesHref(vault, kind, item.id)}
      aria-label={t("viewIssueRollup", {
        count: number(rollup.total),
        name: item.name,
      })}
      aria-describedby={descriptionId}
      className="group/rollup flex min-w-[12rem] flex-col gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
    >
      <span id={descriptionId} className="sr-only">
        {description}
      </span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="inline-flex items-baseline gap-1.5 tabular-nums">
          <span className="font-medium">{number(rollup.total)}</span>
          <span className="text-muted-foreground">{t("issues")}</span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {completion}
        </span>
      </span>
      <span
        data-testid={`planning-rollup-segments-${item.id}`}
        aria-hidden="true"
        className="flex h-1.5 w-full min-w-20 overflow-hidden rounded-full bg-surface-hover"
      >
        {STATUS_SEGMENTS.map(({ key, className }) => (
          <span
            key={key}
            data-testid={`planning-rollup-segment-${item.id}-${key}`}
            className={cn(
              "h-full min-w-0 transition-[width] motion-reduce:transition-none",
              className,
            )}
            style={{ width: segmentWidth(rollup[key], rollup.total) }}
          />
        ))}
      </span>
      <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
        <span>
          {t("rollupCompletedCount", { count: number(rollup.completed) })}
        </span>
        <span>
          {t("rollupInProgressCount", { count: number(rollup.inProgress) })}
        </span>
        <span>
          {t("rollupNotStartedCount", { count: number(rollup.notStarted) })}
        </span>
      </span>
      <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
        <span>{pointSummary}</span>
        {rollup.unestimatedCount > 0 && (
          <span>
            {t("rollupUnestimated", {
              count: number(rollup.unestimatedCount),
            })}
          </span>
        )}
      </span>
      {capacity}
    </a>
  );
}
