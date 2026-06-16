"use client";

import type { Status } from "@reef/core";
import { FilterBar } from "./FilterBar";
import { SearchBar } from "./SearchBar";

interface IssueFilterToolbarProps {
  /** Forwarded to FilterBar to render the backlog view's reduced facet set
   *  (drops Status/Sprint/Release/Due). */
  backlogScope?: boolean;
  /** Forwarded to FilterBar to restrict the Status facet per view. */
  statusOptions?: readonly Status[];
}

export function IssueFilterToolbar({
  backlogScope = false,
  statusOptions,
}: IssueFilterToolbarProps) {
  return (
    <div
      className="flex flex-col gap-2 border-b border-border-subtle bg-background px-6 py-2.5"
      data-testid="issue-filter-toolbar"
    >
      <SearchBar />
      <FilterBar backlogScope={backlogScope} statusOptions={statusOptions} />
    </div>
  );
}
