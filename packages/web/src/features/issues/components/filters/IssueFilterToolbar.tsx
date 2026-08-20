"use client";

import type { Status } from "@reef/core";
import type { IssueGroupBy, IssueWorkspaceView } from "../../lib/groupBy";
import { FilterBar } from "./FilterBar";
import { SearchBar } from "./SearchBar";

interface IssueFilterToolbarProps {
  /** Forwarded to FilterBar to render the backlog view's reduced facet set
   *  (drops Status/Sprint/Release/Due). */
  backlogScope?: boolean;
  /** Forwarded to FilterBar to restrict the Status facet per view. */
  statusOptions?: readonly Status[];
  view?: IssueWorkspaceView;
  groupBy?: IssueGroupBy;
  setGroupBy?: (groupBy: IssueGroupBy) => void;
}

export function IssueFilterToolbar({
  backlogScope = false,
  statusOptions,
  view,
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
        statusOptions={statusOptions}
        view={view}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
      />
    </div>
  );
}
