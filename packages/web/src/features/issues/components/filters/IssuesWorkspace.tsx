"use client";

import { KanbanBoard } from "@/features/board/components/KanbanBoard";
import { BacklogView } from "@/features/issues/components/backlog/BacklogView";
import { IssueFilterToolbar } from "@/features/issues/components/filters/IssueFilterToolbar";
import { SortControl } from "@/features/issues/components/filters/SortControl";
import { ViewSwitcher } from "@/features/issues/components/filters/ViewSwitcher";
import { IssueListTable } from "@/features/issues/components/list/IssueListTable";
import { useIssueFilterPersistence } from "@/features/issues/hooks/view/useIssueFilterPersistence";
import { useIssueUrlSync } from "@/features/issues/hooks/view/useIssueUrlSync";
import { parseViewParam } from "@/features/issues/lib/viewMode";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { TimelineBody } from "@/features/timeline/components/TimelineBody";
import { EmptyWorkspaceNotice } from "@/features/ui/components/EmptyWorkspaceNotice";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { STATUS_OPTIONS, WORKFLOW_STATUS_OPTIONS } from "@reef/core/fields";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

/**
 * Unified issues workspace. Board / List / Timeline / Backlog are peer
 * renderings of the issue collection, so they share one route (`/issues`), one
 * header, one filter toolbar, and one filter scope (`useIssueStore`). The active
 * view is read from `?view=` and swapped via the ViewSwitcher. Backlog is a
 * dedicated triage lens that pins the `backlog` status while the other views
 * render the active workflow.
 *
 * Used both by the `/issues` page and as the backdrop behind the
 * `/issues/[id]` detail slide-over on hard navigation.
 */
export function IssuesWorkspace() {
  const { vault, isLoading } = useActiveVault();
  const searchParams = useSearchParams();
  const view = parseViewParam(searchParams.get("view"));
  const nav = useTranslations("nav");

  const { skipNextSave } = useIssueUrlSync();
  useIssueFilterPersistence(vault, skipNextSave);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={nav("issues")}
        description={vault || undefined}
        actions={
          <div className="flex items-center gap-2">
            {/* Timeline is date-ordered, so the field/direction sort does not
                apply there. Board, list, and backlog share the control; board
                and backlog surface their pristine `rank` order here, while only
                backlog adds the drag affordance (REEF-169/393). */}
            {view === "timeline" ? null : (
              <SortControl
                supportsRankOrder={view === "board" || view === "backlog"}
                showsBacklogReorderHint={view === "backlog"}
              />
            )}
            <ViewSwitcher activeView={view} />
          </div>
        }
      />

      {!vault && !isLoading ? (
        <EmptyWorkspaceNotice />
      ) : (
        <>
          {/* The backlog view drops the facets it pins or does not partition on
              (Status/Sprint/Release/Due); the list can render backlog rows, so
              it keeps the full status set, while board and timeline group
              backlog away so they does not offer it (REEF-109/177). */}
          <IssueFilterToolbar
            backlogScope={view === "backlog"}
            statusOptions={
              view === "list" ? STATUS_OPTIONS : WORKFLOW_STATUS_OPTIONS
            }
          />
          <div className="flex flex-1 min-h-0 flex-col">
            {view === "board" ? (
              <KanbanBoard vault={vault} />
            ) : view === "list" ? (
              <IssueListTable vault={vault} />
            ) : view === "backlog" ? (
              <BacklogView vault={vault} />
            ) : (
              <TimelineBody vault={vault} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
