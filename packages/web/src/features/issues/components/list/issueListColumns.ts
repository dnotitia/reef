// Column headers for the issues table view. Sorting is driven solely by the
// header SortControl — the single sort entry point across every view — so these
// are display labels (REEF-175); this mirrors the backlog's plain header.
//
// Extracted to a standalone module (REEF-258) so IssueListTable's real header
// and IssueListSkeleton's placeholder derive their column count from one source.
// The table uses auto layout, so a skeleton with a different column count makes
// the browser re-compute column widths on hydration — a horizontal jump. Deriving
// the skeleton's cell count from COLUMN_LABELS.length keeps the two in lockstep.
export const COLUMN_LABELS = [
  "ID",
  "Type",
  "Title",
  "Status",
  "Priority",
  "Assignee",
  "Start",
  "Due",
  "Sprint",
  "Milestone",
  "Release",
  "Updated",
  "",
] as const;
