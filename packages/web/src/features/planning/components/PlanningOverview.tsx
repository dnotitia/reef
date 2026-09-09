"use client";

import { DateDisplay } from "@/components/fields/DateDisplay";
import { PlanningStatusBadge } from "@/components/fields/PlanningStatusBadge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  OverflowTooltip,
  useTextOverflow,
} from "@/components/ui/overflow-tooltip";
import { PlanningLoadError } from "@/features/planning/components/PlanningLoadError";
import { cn } from "@/lib/utils";
import {
  computePlanningRollup,
  type IssueListItem,
  type PlanningCatalog,
  type PlanningRollup as PlanningRollupData,
  type Milestone,
  type Release,
  type Sprint,
} from "@reef/core";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef } from "react";
import type { PlanningItem, PlanningKind } from "../hooks/usePlanningCatalog";
import {
  selectActiveSprint,
  upcomingMilestones,
  upcomingReleases,
} from "../lib/planningItems";
import { planningListDetailHref, sprintDetailHref } from "../lib/planningUrls";
import { PlanningOverviewSkeleton } from "./PlanningOverviewSkeleton";
import type { IssueAggregationState } from "./PlanningRollup";
import { PlanningRollup } from "./PlanningRollup";

type OverviewSection =
  | "currentSprint"
  | "upcomingMilestones"
  | "upcomingReleases";

type OverviewRollups = {
  sprints: ReadonlyMap<string, PlanningRollupData>;
  milestones: ReadonlyMap<string, PlanningRollupData>;
  releases: ReadonlyMap<string, PlanningRollupData>;
};

function itemHref(vault: string, kind: PlanningKind, item: PlanningItem) {
  return kind === "sprints"
    ? sprintDetailHref(vault, item.id)
    : planningListDetailHref(vault, kind, item.id);
}

function targetDateOf(kind: PlanningKind, item: PlanningItem): string | null {
  if (kind === "milestones") return (item as Milestone).target_date ?? null;
  if (kind === "releases") return (item as Release).target_date ?? null;
  return null;
}

function localCalendarDate(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function isOverdue(
  kind: PlanningKind,
  item: PlanningItem,
  now: number | null,
): boolean {
  const targetDate = targetDateOf(kind, item)?.trim().slice(0, 10);
  return Boolean(
    targetDate && now !== null && targetDate < localCalendarDate(now),
  );
}

function OverviewDates({
  kind,
  item,
}: {
  kind: PlanningKind;
  item: PlanningItem;
}) {
  const t = useTranslations("planning");
  const detail = useTranslations("planning.detail");

  if (kind === "sprints") {
    const sprint = item as Sprint;
    if (!sprint.start_date && !sprint.end_date) return <>{detail("noDate")}</>;
    return (
      <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
        <DateDisplay date={sprint.start_date} emptyText={detail("noDate")} />
        <span aria-hidden="true">–</span>
        <DateDisplay date={sprint.end_date} emptyText={detail("noDate")} />
      </span>
    );
  }

  if (kind === "milestones") {
    return (
      <DateDisplay
        date={(item as Milestone).target_date}
        emptyText={detail("noDate")}
      />
    );
  }

  const release = item as Release;
  if (release.released_at) {
    return (
      <span>
        {t("released")} <DateDisplay date={release.released_at} />
      </span>
    );
  }
  if (release.target_date) {
    return (
      <span>
        {t("target")} <DateDisplay date={release.target_date} />
      </span>
    );
  }
  return <>{detail("noDate")}</>;
}

function PlanningOverviewItem({
  vault,
  kind,
  item,
  rollup,
  issueAggregationState,
  now,
  featured,
}: {
  vault: string;
  kind: PlanningKind;
  item: PlanningItem;
  rollup: PlanningRollupData | undefined;
  issueAggregationState: IssueAggregationState;
  now: number | null;
  featured: boolean;
}) {
  const t = useTranslations("planning");
  const nameRef = useRef<HTMLSpanElement>(null);
  const isNameOverflowing = useTextOverflow(nameRef, item.name);
  const overdue = isOverdue(kind, item, now);
  const nameLabel =
    kind === "sprints"
      ? t("openSprintDetail", { name: item.name })
      : t("openPlanningListDetail", { name: item.name });
  const nameLink = (
    <a
      href={itemHref(vault, kind, item)}
      data-testid={`planning-overview-link-${item.id}`}
      aria-label={nameLabel}
      title={item.name}
      className="min-w-0 flex-1 truncate whitespace-nowrap rounded font-medium text-brand-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
    >
      <span ref={nameRef} className="block min-w-0 truncate">
        {item.name}
      </span>
    </a>
  );

  return (
    <li data-testid={`planning-overview-item-${item.id}`} className="min-w-0">
      <article
        className={cn(
          "grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(14rem,32rem)] md:items-center",
          featured
            ? "rounded-lg border border-border bg-surface-card p-4"
            : "rounded-md border border-border-subtle bg-surface-subtle p-3",
        )}
      >
        <div className="grid min-w-0 gap-2">
          <div className="flex min-w-0 flex-nowrap items-center gap-x-2">
            <OverflowTooltip
              value={item.name}
              isOverflowing={isNameOverflowing}
            >
              {nameLink}
            </OverflowTooltip>
            <PlanningStatusBadge
              kind={kind}
              status={item.status}
              className="shrink-0"
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="shrink-0">{t("dates")}</span>
            <span className="min-w-0 break-words tabular-nums">
              {overdue ? (
                <span className="mr-2 font-medium text-destructive-text">
                  {t("overview.overdue")}
                </span>
              ) : null}
              <OverviewDates kind={kind} item={item} />
            </span>
          </div>
        </div>
        <PlanningRollup
          vault={vault}
          kind={kind}
          item={item}
          rollup={rollup}
          state={issueAggregationState}
          compact
        />
      </article>
    </li>
  );
}

function PlanningOverviewSection({
  vault,
  section,
  items,
  kind,
  rollups,
  issueAggregationState,
  now,
}: {
  vault: string;
  section: OverviewSection;
  items: readonly PlanningItem[];
  kind: PlanningKind;
  rollups: ReadonlyMap<string, PlanningRollupData> | undefined;
  issueAggregationState: IssueAggregationState;
  now: number | null;
}) {
  const t = useTranslations("planning.overview");
  const sectionId = useId();
  const featured = section === "currentSprint";
  const title = t(section);
  const emptyTitle = t(`${section}EmptyTitle`);
  const emptyDescription = t(`${section}EmptyDescription`);

  return (
    <section
      data-testid={`planning-overview-section-${section}`}
      aria-labelledby={`${sectionId}-title`}
      className={cn("grid min-w-0", featured ? "gap-3" : "gap-2")}
    >
      <h2
        id={`${sectionId}-title`}
        className={cn(
          featured
            ? "type-group-title text-foreground"
            : "type-section-label text-muted-foreground",
        )}
      >
        {title}
      </h2>
      {items.length === 0 ? (
        <EmptyState
          data-testid={`planning-overview-empty-${section}`}
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : (
        <ul
          data-testid={`planning-overview-list-${section}`}
          className="grid min-w-0 gap-3"
        >
          {items.map((item) => (
            <PlanningOverviewItem
              key={item.id}
              vault={vault}
              kind={kind}
              item={item}
              rollup={rollups?.get(item.id)}
              issueAggregationState={issueAggregationState}
              now={now}
              featured={featured}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function PlanningOverview({
  catalog,
  vault,
  issues,
  isLoading,
  isCatalogError,
  isCatalogFetching,
  onRetryCatalog,
  issueAggregationState,
  isIssueFetching,
  onRetryIssues,
  now,
}: {
  catalog: PlanningCatalog | undefined;
  vault: string;
  issues: readonly IssueListItem[] | undefined;
  isLoading: boolean;
  isCatalogError: boolean;
  isCatalogFetching: boolean;
  onRetryCatalog: () => void;
  issueAggregationState: IssueAggregationState;
  isIssueFetching: boolean;
  onRetryIssues: () => void;
  now: number | null;
}) {
  const common = useTranslations("common");
  const t = useTranslations("planning");
  const rollups = useMemo<OverviewRollups | undefined>(() => {
    if (!catalog || issueAggregationState !== "available" || !issues) {
      return undefined;
    }
    return {
      sprints: computePlanningRollup("sprints", catalog.sprints, issues),
      milestones: computePlanningRollup(
        "milestones",
        catalog.milestones,
        issues,
      ),
      releases: computePlanningRollup("releases", catalog.releases, issues),
    };
  }, [catalog, issueAggregationState, issues]);

  if (isLoading) {
    return (
      <>
        <output className="sr-only">{common("loading")}</output>
        <PlanningOverviewSkeleton />
      </>
    );
  }

  if (isCatalogError || !catalog) {
    return (
      <PlanningLoadError
        testId="planning-catalog-error"
        title={t("catalogLoadErrorTitle")}
        description={t("catalogLoadErrorDescription")}
        isFetching={isCatalogFetching}
        onRetry={onRetryCatalog}
      />
    );
  }

  const currentSprint = selectActiveSprint(catalog.sprints);
  const milestones = upcomingMilestones(catalog.milestones);
  const releases = upcomingReleases(catalog.releases);
  const issueError =
    issueAggregationState === "unavailable" ? (
      <PlanningLoadError
        testId="planning-issue-error"
        title={t("issueLoadErrorTitle")}
        description={t("issueLoadErrorDescription")}
        isFetching={isIssueFetching}
        onRetry={onRetryIssues}
      />
    ) : null;

  return (
    <div data-testid="planning-overview" className="grid min-w-0 gap-6">
      {issueError}
      <PlanningOverviewSection
        vault={vault}
        section="currentSprint"
        items={currentSprint ? [currentSprint] : []}
        kind="sprints"
        rollups={rollups?.sprints}
        issueAggregationState={issueAggregationState}
        now={now}
      />
      <PlanningOverviewSection
        vault={vault}
        section="upcomingMilestones"
        items={milestones}
        kind="milestones"
        rollups={rollups?.milestones}
        issueAggregationState={issueAggregationState}
        now={now}
      />
      <PlanningOverviewSection
        vault={vault}
        section="upcomingReleases"
        items={releases}
        kind="releases"
        rollups={rollups?.releases}
        issueAggregationState={issueAggregationState}
        now={now}
      />
    </div>
  );
}
