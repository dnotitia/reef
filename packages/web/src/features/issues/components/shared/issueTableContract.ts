export type IssueTableFieldColumnKey =
  | "id"
  | "type"
  | "title"
  | "status"
  | "priority"
  | "assignee"
  | "start"
  | "due"
  | "sprint"
  | "milestone"
  | "release"
  | "updated";

export type IssueTableColumnKey = "select" | "rank" | IssueTableFieldColumnKey;

export type IssueListOptionalColumnKey =
  | "start"
  | "sprint"
  | "milestone"
  | "release";

export const ISSUE_TABLE_HEADER_HEIGHT = 32;
export const ISSUE_TABLE_ROW_HEIGHT = 40;
export const ISSUE_TABLE_TITLE_MIN_WIDTH = 240;

export const ISSUE_TABLE_COLUMN_WIDTHS = {
  select: 40,
  rank: 40,
  id: 72,
  type: 72,
  title: ISSUE_TABLE_TITLE_MIN_WIDTH,
  status: 152,
  priority: 88,
  assignee: 128,
  start: 104,
  due: 96,
  sprint: 112,
  milestone: 128,
  release: 112,
  updated: 104,
} as const satisfies Record<IssueTableColumnKey, number>;

export const ISSUE_LIST_DEFAULT_COLUMNS = [
  "select",
  "id",
  "type",
  "title",
  "status",
  "priority",
  "assignee",
  "due",
  "updated",
] as const satisfies readonly IssueTableColumnKey[];

export const ISSUE_LIST_OPTIONAL_COLUMNS = [
  "start",
  "sprint",
  "milestone",
  "release",
] as const satisfies readonly IssueListOptionalColumnKey[];

export const ISSUE_LIST_COLUMN_ORDER = [
  "select",
  "id",
  "type",
  "title",
  "status",
  "priority",
  "assignee",
  "start",
  "sprint",
  "milestone",
  "release",
  "due",
  "updated",
] as const satisfies readonly IssueTableColumnKey[];

export const BACKLOG_COLUMNS = [
  "rank",
  "id",
  "type",
  "title",
  "status",
  "priority",
  "assignee",
  "updated",
] as const satisfies readonly IssueTableColumnKey[];

export const ISSUE_TABLE_STICKY_COLUMNS = [
  "select",
  "id",
  "type",
  "title",
] as const satisfies readonly IssueTableColumnKey[];

export type IssueListColumnKey = (typeof ISSUE_LIST_COLUMN_ORDER)[number];

export function resolveIssueListColumns(
  optionalColumns: readonly IssueListOptionalColumnKey[],
): readonly IssueListColumnKey[] {
  const selected = new Set(optionalColumns);
  return ISSUE_LIST_COLUMN_ORDER.filter(
    (key) =>
      !ISSUE_LIST_OPTIONAL_COLUMNS.includes(
        key as IssueListOptionalColumnKey,
      ) || selected.has(key as IssueListOptionalColumnKey),
  );
}

export function issueTableWidth(columns: readonly IssueTableColumnKey[]) {
  return columns.reduce(
    (total, column) => total + ISSUE_TABLE_COLUMN_WIDTHS[column],
    0,
  );
}

export function issueTableColumnOffset(
  columns: readonly IssueTableColumnKey[],
  column: IssueTableColumnKey,
) {
  return columns
    .slice(0, columns.indexOf(column))
    .reduce((total, current) => total + ISSUE_TABLE_COLUMN_WIDTHS[current], 0);
}

export function isIssueTableStickyColumn(column: IssueTableColumnKey) {
  return ISSUE_TABLE_STICKY_COLUMNS.some(
    (stickyColumn) => stickyColumn === column,
  );
}
