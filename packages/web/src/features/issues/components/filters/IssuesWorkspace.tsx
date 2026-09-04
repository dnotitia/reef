"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { KanbanBoard } from "@/features/board/components/KanbanBoard";
import { BacklogView } from "@/features/issues/components/backlog/BacklogView";
import { IssueBulkActionBar } from "@/features/issues/components/bulk/IssueBulkActionBar";
import { IssueFilterToolbar } from "@/features/issues/components/filters/IssueFilterToolbar";
import { ScopeSwitcher } from "@/features/issues/components/filters/ScopeSwitcher";
import { ViewSwitcher } from "@/features/issues/components/filters/ViewSwitcher";
import { IssueListTable } from "@/features/issues/components/list/IssueListTable";
import { useIssueFilterPersistence } from "@/features/issues/hooks/view/useIssueFilterPersistence";
import { useIssueUrlSync } from "@/features/issues/hooks/view/useIssueUrlSync";
import {
  parseIssueViewState,
  type IssueLayout,
} from "@/features/issues/lib/viewMode";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { TimelineBody } from "@/features/timeline/components/TimelineBody";
import { EmptyWorkspaceNotice } from "@/features/ui/components/EmptyWorkspaceNotice";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import { selectActiveSprint } from "@/features/planning/lib/planningItems";
import {
  sprintDetailHref,
  sprintDetailPath,
} from "@/features/planning/lib/planningUrls";
import { withVault } from "@/lib/workspaceHref";
import { WORKFLOW_STATUS_OPTIONS } from "@reef/core/fields";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export interface IssuesWorkspaceProps {
  /** Pin all issue queries to a sprint while keeping the shared filter store intact. */
  fixedSprintId?: string;
  fixedSprintName?: string;
  fixedSprintUnlockHref?: string;
  /** Omit the standard Issues page header when another surface owns the chrome. */
  hideHeader?: boolean;
}

function CurrentSprintShortcut({ vault }: { vault: string }) {
  const { data: planningCatalog } = usePlanningCatalog(vault);
  const currentSprint = selectActiveSprint(planningCatalog?.sprints ?? []);
  const t = useTranslations("issues.filters");

  if (!currentSprint) return null;
  const detailLabel = t("openCurrentSprintDetails", {
    name: currentSprint.name,
  });

  return (
    <div
      className="min-w-0 max-w-[min(15rem,28vw)]"
      data-testid="current-sprint-shortcut"
      data-sprint-id={currentSprint.id}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={sprintDetailHref(vault, currentSprint.id)}
              aria-label={detailLabel}
              className="block min-w-0 max-w-full truncate type-control font-medium text-brand-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {currentSprint.name}
            </a>
          </TooltipTrigger>
          <TooltipContent>{detailLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function unlockedIssuesHref(
  vault: string,
  searchParams: URLSearchParams,
  layout: "board" | "list",
): string {
  const next = new URLSearchParams(searchParams);
  next.delete("scope");
  next.delete("sprint_id");
  next.set("view", layout);
  const query = next.toString();
  return withVault(vault, query ? `/issues?${query}` : "/issues");
}

/**
 * Unified issues workspace. Scope (`active` / `backlog`) and layout
 * (`board` / `list` / `timeline`) share one route, header, filter toolbar, and
 * filter scope (`useIssueStore`). The URL codec keeps those axes independent
 * while normalizing the unsupported Backlog + Timeline combination.
 *
 * Used both by the `/issues` page and as the backdrop behind the
 * `/issues/[id]` detail slide-over on hard navigation.
 */
export function IssuesWorkspace({
  fixedSprintId,
  fixedSprintName,
  fixedSprintUnlockHref,
  hideHeader = false,
}: IssuesWorkspaceProps = {}) {
  const { vault, isLoading } = useActiveVault();
  const router = useRouter();
  const searchParams = useSearchParams();
  const parsedView = parseIssueViewState(searchParams);
  const scope = fixedSprintId ? "active" : parsedView.scope;
  const layout =
    fixedSprintId && parsedView.layout === "timeline"
      ? "board"
      : parsedView.layout;
  const nav = useTranslations("nav");
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const clearSelectionForContextChange = useIssueSelectionStore(
    (state) => state.clearForContextChange,
  );
  // Keep the two header controls on the same user intent while the App Router
  // is still reflecting an earlier view navigation. The URL remains the source
  // of truth; this only lets a scope change normalize the latest requested view.
  const [pendingLayout, setPendingLayout] = useState<IssueLayout | null>(null);
  const previousLayout = useRef(layout);
  const headerLayout = pendingLayout ?? layout;
  const selectionContext = JSON.stringify({
    filter,
    searchQuery,
    vault,
    scope,
    layout,
  });
  const previousSelectionContext = useRef<string | null>(null);

  useEffect(() => {
    if (previousLayout.current === layout) return;
    previousLayout.current = layout;
    setPendingLayout(null);
  }, [layout]);

  const {
    skipNextSave,
    groupBy,
    setGroupBy,
    listOptionalColumns,
    applyMyViewSnapshot,
  } = useIssueUrlSync({
    preserveFilterOnNonListRoute: Boolean(fixedSprintId),
  });
  useIssueFilterPersistence(vault, skipNextSave);

  useEffect(() => {
    if (!fixedSprintId) return;
    const hasUnsupportedScope = searchParams.get("scope") != null;
    const hasUnsupportedLayout = searchParams.get("view") === "timeline";
    if (!hasUnsupportedScope && !hasUnsupportedLayout) return;

    const next = new URLSearchParams(searchParams);
    next.delete("scope");
    next.set("view", layout);
    router.replace(
      withVault(vault, `${sprintDetailPath(fixedSprintId)}?${next.toString()}`),
      { scroll: false },
    );
  }, [fixedSprintId, layout, router, searchParams, vault]);

  useEffect(() => {
    if (previousSelectionContext.current === selectionContext) return;
    previousSelectionContext.current = selectionContext;
    clearSelectionForContextChange();
  }, [clearSelectionForContextChange, selectionContext]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {hideHeader ? null : (
        <PageHeader
          title={nav("issues")}
          description={vault || undefined}
          titleAdjacent={
            <div className="flex min-w-0 max-w-full items-center gap-2">
              <ScopeSwitcher activeScope={scope} activeLayout={headerLayout} />
              {!fixedSprintId && scope === "active" ? (
                <div className="w-[min(15rem,28vw)] min-w-0">
                  <CurrentSprintShortcut vault={vault} />
                </div>
              ) : null}
            </div>
          }
          className="h-auto min-h-12 flex-wrap py-2"
          actions={
            <ViewSwitcher
              scope={scope}
              activeLayout={headerLayout}
              onLayoutChange={setPendingLayout}
              basePath={
                fixedSprintId ? sprintDetailPath(fixedSprintId) : "/issues"
              }
              hideTimeline={Boolean(fixedSprintId)}
            />
          }
        />
      )}

      {!vault && !isLoading ? (
        <EmptyWorkspaceNotice />
      ) : (
        <>
          {fixedSprintId ? (
            <IssueFilterToolbar
              backlogScope={false}
              scope="active"
              statusOptions={WORKFLOW_STATUS_OPTIONS}
              view={layout}
              showSortControl
              supportsRankOrder
              fixedSprintId={fixedSprintId}
              fixedSprintName={fixedSprintName}
              fixedSprintUnlockHref={
                fixedSprintUnlockHref ??
                unlockedIssuesHref(
                  vault,
                  searchParams,
                  layout === "timeline" ? "board" : layout,
                )
              }
              groupBy={groupBy}
              setGroupBy={setGroupBy}
              listOptionalColumns={listOptionalColumns}
              applyMyViewSnapshot={applyMyViewSnapshot}
            />
          ) : (
            // Backlog scope drops the facets it pins or does not partition on
            // (Status/Sprint/Release/Due); Active keeps only workflow statuses.
            <IssueFilterToolbar
              backlogScope={scope === "backlog"}
              scope={scope}
              statusOptions={WORKFLOW_STATUS_OPTIONS}
              view={layout}
              showSortControl={layout !== "timeline"}
              supportsRankOrder={layout !== "timeline"}
              showsBacklogReorderHint={scope === "backlog"}
              groupBy={groupBy}
              setGroupBy={setGroupBy}
              listOptionalColumns={listOptionalColumns}
              applyMyViewSnapshot={applyMyViewSnapshot}
            />
          )}
          {layout === "list" ? (
            <IssueBulkActionBar
              vault={vault}
              preset={scope === "backlog" ? "backlog" : "list"}
            />
          ) : null}
          <div
            className={
              layout === "list"
                ? "flex min-h-48 min-w-0 flex-1 flex-col"
                : "flex min-h-0 min-w-0 flex-1 flex-col"
            }
          >
            {layout === "board" ? (
              <KanbanBoard
                vault={vault}
                scope={scope}
                groupBy={groupBy}
                fixedSprintId={fixedSprintId}
              />
            ) : layout === "list" && scope === "active" ? (
              <IssueListTable
                vault={vault}
                scope={scope}
                groupBy={groupBy}
                fixedSprintId={fixedSprintId}
              />
            ) : layout === "list" ? (
              <BacklogView vault={vault} groupBy={groupBy} />
            ) : (
              <TimelineBody vault={vault} scope={scope} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
