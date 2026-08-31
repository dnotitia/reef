"use client";

import { KanbanBoard } from "@/features/board/components/KanbanBoard";
import { BacklogView } from "@/features/issues/components/backlog/BacklogView";
import { IssueBulkActionBar } from "@/features/issues/components/bulk/IssueBulkActionBar";
import { IssueFilterToolbar } from "@/features/issues/components/filters/IssueFilterToolbar";
import { ScopeSwitcher } from "@/features/issues/components/filters/ScopeSwitcher";
import { ViewSwitcher } from "@/features/issues/components/filters/ViewSwitcher";
import { IssueListTable } from "@/features/issues/components/list/IssueListTable";
import { useIssueFilterPersistence } from "@/features/issues/hooks/view/useIssueFilterPersistence";
import { useIssueUrlSync } from "@/features/issues/hooks/view/useIssueUrlSync";
import { parseIssueViewState } from "@/features/issues/lib/viewMode";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { TimelineBody } from "@/features/timeline/components/TimelineBody";
import { EmptyWorkspaceNotice } from "@/features/ui/components/EmptyWorkspaceNotice";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { Button } from "@/components/ui/button";
import { withVault } from "@/lib/workspaceHref";
import { WORKFLOW_STATUS_OPTIONS } from "@reef/core/fields";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Unified issues workspace. Scope (`active` / `backlog`) and layout
 * (`board` / `list` / `timeline`) share one route, header, filter toolbar, and
 * filter scope (`useIssueStore`). The URL codec keeps those axes independent
 * while normalizing the unsupported Backlog + Timeline combination.
 *
 * Used both by the `/issues` page and as the backdrop behind the
 * `/issues/[id]` detail slide-over on hard navigation.
 */
export function IssuesWorkspace() {
  const { vault, isLoading } = useActiveVault();
  const searchParams = useSearchParams();
  const { scope, layout } = parseIssueViewState(searchParams);
  const nav = useTranslations("nav");
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const clearSelectionForContextChange = useIssueSelectionStore(
    (state) => state.clearForContextChange,
  );
  const selectionContext = JSON.stringify({
    filter,
    searchQuery,
    vault,
    scope,
    layout,
  });
  const previousSelectionContext = useRef<string | null>(null);

  const {
    skipNextSave,
    groupBy,
    setGroupBy,
    listOptionalColumns,
    applyMyViewSnapshot,
  } = useIssueUrlSync();
  useIssueFilterPersistence(vault, skipNextSave);

  useEffect(() => {
    if (previousSelectionContext.current === selectionContext) return;
    previousSelectionContext.current = selectionContext;
    clearSelectionForContextChange();
  }, [clearSelectionForContextChange, selectionContext]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title={nav("issues")}
        description={vault || undefined}
        titleAdjacent={
          <ScopeSwitcher activeScope={scope} activeLayout={layout} />
        }
        className="h-auto min-h-12 flex-wrap py-2"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {vault ? (
              <Button asChild size="sm" variant="outline">
                <Link href={withVault(vault, "/issues/changes")}>
                  {nav("changeReview")}
                </Link>
              </Button>
            ) : null}
            <ViewSwitcher scope={scope} activeLayout={layout} />
          </div>
        }
      />

      {!vault && !isLoading ? (
        <EmptyWorkspaceNotice />
      ) : (
        <>
          {/* Backlog scope drops the facets it pins or does not partition on
              (Status/Sprint/Release/Due); Active keeps only workflow statuses. */}
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
              <KanbanBoard vault={vault} scope={scope} groupBy={groupBy} />
            ) : layout === "list" && scope === "active" ? (
              <IssueListTable vault={vault} scope={scope} groupBy={groupBy} />
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
