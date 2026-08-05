// Column keys for the issues table view. Sorting is driven solely by the header
// SortControl — the single sort entry point across every view — so these are
// display labels (REEF-175); this mirrors the backlog's plain header. The header
// text is locale-resolved at render time from the shared `fieldNames` catalog
// (REEF-299); a `null` entry is the trailing action column, which has no label.
// Each non-null key is checked against `FieldNameKey` where IssueListTable
// indexes `useFieldNameLabels()` with it, so a typo fails typecheck there.
//
// Extracted to a standalone module (REEF-258) so IssueListTable's real header
// and IssueListSkeleton's placeholder derive their column count from one source.
// The table uses auto layout, so a skeleton with a different column count makes
// the browser re-compute column widths on hydration — a horizontal jump. Deriving
// the skeleton's cell count from COLUMN_KEYS.length keeps the two in lockstep.
export const COLUMN_KEYS = [
  null,
  "id",
  "type",
  "title",
  "status",
  "priority",
  "assignee",
  "start",
  "due",
  "sprint",
  "milestone",
  "release",
  "updated",
  null,
] as const;

// Fixed column hints keep the table geometry stable while only the mounted
// virtual rows change. The total is intentionally wider than a narrow viewport;
// the existing horizontal table scroll remains the way to reach planning fields.
export const COLUMN_WIDTHS = [
  40, 96, 80, 320, 104, 96, 144, 112, 112, 144, 144, 144, 128, 48,
] as const;
