"use client";

import { DateDisplay } from "@/components/fields/DateDisplay";
import type { Milestone, Release, Sprint } from "@reef/core";
import { useTranslations } from "next-intl";
import type { PlanningItem, PlanningKind } from "../hooks/usePlanningCatalog";

export function PlanningDates({
  kind,
  item,
  emptyText = "—",
}: {
  kind: PlanningKind;
  item: PlanningItem;
  emptyText?: string;
}) {
  const t = useTranslations("planning");

  if (kind === "sprints") {
    const sprint = item as Sprint;
    if (!sprint.start_date && !sprint.end_date) return <>{emptyText}</>;
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <DateDisplay date={sprint.start_date} emptyText="?" />
        <span aria-hidden="true">–</span>
        <DateDisplay date={sprint.end_date} emptyText="?" />
      </span>
    );
  }

  if (kind === "milestones") {
    return (
      <DateDisplay
        date={(item as Milestone).target_date}
        emptyText={emptyText}
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
  return <>{emptyText}</>;
}
