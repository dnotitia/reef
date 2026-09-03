"use client";

import { MarkdownEditor } from "@/components/MarkdownEditor";
import { PlanningStatusBadge } from "@/components/fields/PlanningStatusBadge";
import { ViewSwitcher } from "@/features/issues/components/filters/ViewSwitcher";
import { formatDisplayDate } from "@/features/issues/lib/dateHelpers";
import { withVault } from "@/lib/workspaceHref";
import { useLocale, useTranslations } from "next-intl";
import type { PlanningRollup, Sprint } from "@reef/core";
import { ArrowLeft } from "lucide-react";
import { sprintDetailPath } from "../lib/planningUrls";
import {
  type SprintTimeState,
  sprintTimeState,
} from "../lib/sprintDetailUtils";
import type { HealthRollupRow } from "../../reports/lib/healthRollup";

const HEALTH_COLOR: Record<
  NonNullable<HealthRollupRow["verdict"]>["level"],
  string
> = {
  on_track: "var(--status-done-chart)",
  at_risk: "var(--priority-medium)",
  off_track: "var(--destructive-chart)",
};

function goalPreview(goal: string): string {
  const line = goal.split("\n").find((candidate) => candidate.trim()) ?? "";
  return line
    .replace(/[#>*_`~]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function renderDate(
  value: string | null | undefined,
  locale: string,
  empty: string,
): string {
  return value ? formatDisplayDate(value.slice(0, 10), locale) : empty;
}

function SprintHealthChip({
  verdict,
}: {
  verdict: HealthRollupRow["verdict"];
}) {
  const t = useTranslations("reports.cards") as unknown as (
    key: string,
  ) => string;
  const detail = useTranslations("planning.detail");
  const label = verdict
    ? t(`rag.${verdict.level}`)
    : detail("healthUnavailable");
  return (
    <span
      data-testid="sprint-detail-health"
      aria-label={`${detail("health")}: ${label}`}
      className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-subtle px-2 py-0.5 type-card-metadata font-medium"
      style={{ color: verdict ? HEALTH_COLOR[verdict.level] : undefined }}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-current"
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

function SprintTimeLabel({ state }: { state: SprintTimeState }) {
  const t = useTranslations("planning.detail");
  if (!state) return <>{t("noEndDate")}</>;
  return state.kind === "remaining"
    ? t("daysLeft", { days: state.days })
    : t("daysElapsed", { days: state.days });
}

export function SprintDetailHeader({
  vault,
  sprint,
  rollup,
  health,
  now,
  view,
}: {
  vault: string;
  sprint: Sprint;
  rollup: PlanningRollup | undefined;
  health: HealthRollupRow["verdict"];
  now: number | null;
  view: "board" | "list";
}) {
  const locale = useLocale();
  const t = useTranslations("planning.detail");
  const emptyDate = t("noDate");
  const time = now === null ? null : sprintTimeState(sprint, now);
  const preview = goalPreview(sprint.goal);

  return (
    <header
      data-testid="sprint-detail-header"
      className="shrink-0 border-b border-border-subtle bg-surface-page px-6 py-3"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <a
              href={withVault(vault, "/planning")}
              aria-label={t("backToPlanning")}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
            </a>
            <h1 className="min-w-0 truncate type-page-title text-foreground">
              {sprint.name}
            </h1>
            <PlanningStatusBadge kind="sprints" status={sprint.status} />
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 type-card-metadata text-muted-foreground">
            <span
              data-testid="sprint-detail-date-range"
              className="tabular-nums"
            >
              {renderDate(sprint.start_date, locale, emptyDate)}
              <span aria-hidden="true"> – </span>
              {renderDate(sprint.end_date, locale, emptyDate)}
            </span>
            <span
              data-testid="sprint-detail-time"
              className="font-medium text-foreground"
            >
              <SprintTimeLabel state={time} />
            </span>
            <SprintHealthChip verdict={health} />
            <span data-testid="sprint-detail-count" className="tabular-nums">
              {rollup
                ? t("resolvedOfTotal", {
                    resolved: rollup.completed,
                    total: rollup.total,
                  })
                : t("issuesLoading")}
            </span>
          </div>
        </div>
        <ViewSwitcher
          activeLayout={view}
          scope="active"
          basePath={sprintDetailPath(sprint.id)}
          hideTimeline
          includeScope={false}
        />
      </div>

      <details data-testid="sprint-detail-goal" className="mt-3 min-w-0">
        <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 type-control font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40 [&::-webkit-details-marker]:hidden">
          <span className="shrink-0 text-muted-foreground">{t("goal")}</span>
          <span className="min-w-0 truncate text-muted-foreground">
            {preview || t("noGoal")}
          </span>
        </summary>
        <div className="mt-2 min-w-0">
          {sprint.goal ? (
            <MarkdownEditor
              value={sprint.goal}
              onChange={() => undefined}
              readOnly
              ariaLabel={t("goal")}
            />
          ) : (
            <p className="px-3 py-2 type-caption text-muted-foreground">
              {t("noGoal")}
            </p>
          )}
        </div>
      </details>
    </header>
  );
}
