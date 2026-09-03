"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IssuesWorkspace } from "@/features/issues/components/filters/IssuesWorkspace";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { parseIssueViewState } from "@/features/issues/lib/viewMode";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { EmptyWorkspaceNotice } from "@/features/ui/components/EmptyWorkspaceNotice";
import { useHydrated } from "@/lib/useHydrated";
import { withVault } from "@/lib/workspaceHref";
import { usePlanningCatalog } from "../hooks/usePlanningCatalog";
import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import {
  computePlanningRollup,
  type PlanningRollup,
  type Sprint,
} from "@reef/core";
import { SprintDetailHeader } from "./SprintDetailHeader";
import { SprintDetailPageSkeleton } from "./SprintDetailPageSkeleton";
import {
  DEFAULT_REPORT_FILTERS,
  type ReportFilters,
} from "../../reports/lib/aggregateModel";
import {
  computeHealthRollup,
  type HealthRollupRow,
} from "../../reports/lib/healthRollup";

function detailView(searchParams: URLSearchParams): "board" | "list" {
  return parseIssueViewState(searchParams).layout === "list" ? "list" : "board";
}

function DetailMessage({
  testId,
  title,
  description,
  onRetry,
  isFetching,
  backHref,
  backLabel,
}: {
  testId: string;
  title: string;
  description: string;
  onRetry?: () => void;
  isFetching?: boolean;
  backHref: string;
  backLabel: string;
}) {
  const common = useTranslations("common");
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-12">
      <div
        data-testid={testId}
        role="alert"
        className="w-full max-w-xl rounded-lg border border-destructive-focus/30 bg-destructive-fill/[0.04] px-4 py-4"
      >
        <h2 className="text-sm font-semibold text-destructive-text">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        {onRetry ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            busy={isFetching}
            className="mt-3"
            onClick={onRetry}
          >
            {common("retry")}
          </Button>
        ) : null}
      </div>
      <a
        href={backHref}
        className="type-control font-medium text-brand-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
      >
        {backLabel}
      </a>
    </div>
  );
}

function SprintNotFound({ vault }: { vault: string }) {
  const t = useTranslations("planning.detail");
  const href = withVault(vault, "/planning");
  return (
    <div
      data-testid="sprint-detail-not-found"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-12"
    >
      <EmptyState
        title={t("notFoundTitle")}
        description={t("notFoundDescription")}
      />
      <a
        href={href}
        className="type-control font-medium text-brand-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
      >
        {t("backToPlanning")}
      </a>
    </div>
  );
}

function SprintDetailFrame({
  vault,
  sprint,
  rollup,
  health,
  now,
  children,
}: {
  vault: string;
  sprint: Sprint;
  rollup: PlanningRollup | undefined;
  health: HealthRollupRow["verdict"];
  now: number | null;
  children: React.ReactNode;
}) {
  const t = useTranslations("planning.detail");
  const searchParams = useSearchParams();
  const view = detailView(searchParams);
  return (
    <div
      data-testid="sprint-detail-page"
      className="flex h-full min-h-0 min-w-0 flex-col"
    >
      <SprintDetailHeader
        vault={vault}
        sprint={sprint}
        rollup={rollup}
        health={health}
        now={now}
        view={view}
      />
      <div
        data-testid="sprint-burnup-slot"
        data-slot="sprint-burnup"
        aria-label={t("burnupSlot")}
        className="sr-only"
      />
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function SprintDetailPage() {
  const params = useParams<{ id?: string; vault?: string }>();
  const routeSprintId = typeof params?.id === "string" ? params.id : "";
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const catalogQuery = usePlanningCatalog(vault);
  // The header rollups need the whole-vault issue graph so blockers outside the
  // sprint still affect health; the nested IssuesWorkspace applies the fixed
  // sprint query for the visible Board/List rows.
  const issueQuery = useIssueList(routeSprintId ? vault : "");
  const hydrated = useHydrated();
  const now = hydrated ? Date.now() : null;
  const t = useTranslations("planning.detail");

  if (!vault && !vaultLoading) return <EmptyWorkspaceNotice />;
  if (vaultLoading || catalogQuery.isPending) {
    return <SprintDetailPageSkeleton />;
  }

  const catalog = catalogQuery.data;
  if (catalogQuery.isError || !catalog) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <DetailMessage
          testId="sprint-detail-catalog-error"
          title={t("catalogErrorTitle")}
          description={t("catalogErrorDescription")}
          onRetry={() => void catalogQuery.refetch()}
          isFetching={catalogQuery.isFetching}
          backHref={withVault(vault, "/planning")}
          backLabel={t("backToPlanning")}
        />
      </div>
    );
  }

  const sprint = catalog.sprints.find((item) => item.id === routeSprintId);
  if (!sprint) return <SprintNotFound vault={vault} />;

  if (issueQuery.isError) {
    return (
      <SprintDetailFrame
        vault={vault}
        sprint={sprint}
        rollup={undefined}
        health={null}
        now={now}
      >
        <DetailMessage
          testId="sprint-detail-issue-error"
          title={t("issueErrorTitle")}
          description={t("issueErrorDescription")}
          onRetry={() => void issueQuery.refetch()}
          isFetching={issueQuery.isFetching}
          backHref={withVault(vault, "/planning")}
          backLabel={t("backToPlanning")}
        />
      </SprintDetailFrame>
    );
  }

  const issues = issueQuery.data;
  const rollup = issues
    ? computePlanningRollup("sprints", [sprint], issues).get(sprint.id)
    : undefined;
  const health = issues
    ? (computeHealthRollup(issues, {
        dimension: "sprint",
        catalog,
        filters: DEFAULT_REPORT_FILTERS satisfies ReportFilters,
        now: now ?? Date.now(),
      }).find((row) => row.id === sprint.id)?.verdict ?? null)
    : null;

  return (
    <SprintDetailFrame
      vault={vault}
      sprint={sprint}
      rollup={rollup}
      health={health}
      now={now}
    >
      <IssuesWorkspace
        hideHeader
        fixedSprintId={sprint.id}
        fixedSprintName={sprint.name}
      />
    </SprintDetailFrame>
  );
}
