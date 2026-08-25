"use client";

import type { Status } from "@reef/core";
import type { IssueGroupBy, IssueWorkspaceView } from "../../lib/groupBy";
import type { IssueScope } from "../../lib/viewMode";
import { FilterBar } from "./FilterBar";
import { SearchBar } from "./SearchBar";

interface IssueFilterToolbarProps {
  /** Forwarded to FilterBar to render the backlog view's reduced facet set
   *  (drops Status/Sprint/Release/Due). */
  backlogScope?: boolean;
  scope?: IssueScope;
  /** Forwarded to FilterBar to restrict the Status facet per view. */
  statusOptions?: readonly Status[];
  view?: IssueWorkspaceView;
  /** Render the shared field/direction sort for views that support it. */
  showSortControl?: boolean;
  /** Treat the pristine shared sort state as Jira rank order. */
  supportsRankOrder?: boolean;
  /** Add the backlog-only drag affordance to the rank option. */
  showsBacklogReorderHint?: boolean;
  groupBy?: IssueGroupBy;
  setGroupBy?: (groupBy: IssueGroupBy) => void;
}

export function IssueFilterToolbar({
  backlogScope = false,
  scope = backlogScope ? "backlog" : "active",
  statusOptions,
  view,
  showSortControl,
  supportsRankOrder = false,
  showsBacklogReorderHint = false,
  groupBy,
  setGroupBy,
}: IssueFilterToolbarProps) {
  return (
    <div
      className="flex min-w-0 flex-col gap-2 border-b border-border-subtle bg-surface-page px-6 py-2.5"
      data-testid="issue-filter-toolbar"
    >
      <SearchBar />
      <FilterBar
        backlogScope={backlogScope}
        scope={scope}
        statusOptions={statusOptions}
        view={view}
        showSortControl={showSortControl}
        supportsRankOrder={supportsRankOrder}
        showsBacklogReorderHint={showsBacklogReorderHint}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
      />
    </div>
  );
}
